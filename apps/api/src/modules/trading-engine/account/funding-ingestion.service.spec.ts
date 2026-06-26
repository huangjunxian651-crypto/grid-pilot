import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FundingIngestionService, type FundingAdapter } from './funding-ingestion.service';

// ── Mock Prisma ───────────────────────────────────────────────────────────────

function makePrismaMock() {
  return {
    fundingEvent: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue({}),
    },
    run: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
  };
}

// ── Fake Adapter ──────────────────────────────────────────────────────────────

function makeFakeAdapter(records: Array<{ symbol: string; fundingTime: number; amount: number }>): FundingAdapter {
  return {
    fetchFundingHistory: vi.fn().mockResolvedValue(records),
  };
}

// ── Test constants ────────────────────────────────────────────────────────────

const CREDENTIAL_ID = 'cred-test-1';
const SYMBOL = 'ETH/USDT';
const RUN_ID = 'run-abc-123';

// T = 2024-01-15 08:00:00 UTC（模拟资金费时间）
const FUNDING_TIME_MS = 1705312800000;
const FUNDING_TIME_DATE = new Date(FUNDING_TIME_MS);
// 原始资金费现金流，付出为负（FundingEvent.amount 原值）；归因后 Run.totalFunding 累加 -AMOUNT（正成本，配合 net=realized−fees−funding）。
const AMOUNT = -1.23;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FundingIngestionService', () => {
  let service: FundingIngestionService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let snapshotMock: { getActivePollers: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prismaMock = makePrismaMock();
    snapshotMock = { getActivePollers: vi.fn().mockReturnValue([]) };
    // 初始化 service（DB 不可达，用 mock）
    service = new FundingIngestionService(prismaMock as never, snapshotMock as never);
  });
  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('runCycle：遍历活跃账户逐个 ingest（防重入）', () => {
    it('对每个活跃账户调用 ingestForCredential', async () => {
      const a1 = makeFakeAdapter([]);
      const a2 = makeFakeAdapter([]);
      snapshotMock.getActivePollers.mockReturnValue([
        { credentialId: 'cred-1', adapter: a1, symbols: ['ETH/USDT'] },
        { credentialId: 'cred-2', adapter: a2, symbols: ['BTC/USDT'] },
      ]);
      const spy = vi.spyOn(service, 'ingestForCredential').mockResolvedValue();
      await service.runCycle();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith('cred-1', a1, ['ETH/USDT']);
      expect(spy).toHaveBeenCalledWith('cred-2', a2, ['BTC/USDT']);
    });

    it('防重入：上一轮未完成时本轮直接返回，不再遍历', async () => {
      snapshotMock.getActivePollers.mockReturnValue([
        { credentialId: 'cred-1', adapter: makeFakeAdapter([]), symbols: ['ETH/USDT'] },
      ]);
      let release!: () => void;
      const spy = vi
        .spyOn(service, 'ingestForCredential')
        .mockImplementation(() => new Promise<void>((r) => { release = r; }));
      const first = service.runCycle(); // 卡在 ingestForCredential
      await service.runCycle(); // 重入：应直接返回
      expect(snapshotMock.getActivePollers).toHaveBeenCalledTimes(1); // 第二次未再遍历
      release();
      await first;
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('单账户失败只 warn，不抛出', async () => {
      snapshotMock.getActivePollers.mockReturnValue([
        { credentialId: 'cred-bad', adapter: makeFakeAdapter([]), symbols: ['ETH/USDT'] },
      ]);
      vi.spyOn(service, 'ingestForCredential').mockRejectedValue(new Error('boom'));
      await expect(service.runCycle()).resolves.toBeUndefined();
    });
  });

  describe('场景 1：资金费落在 Run 窗口内 → 归因 + 原子写入 totalFunding', () => {
    beforeEach(() => {
      // DB cursor：无历史记录
      prismaMock.fundingEvent.findFirst = vi.fn().mockResolvedValue(null);
      // 查归因 Run：找到一个活跃 run
      prismaMock.run.findFirst = vi.fn().mockResolvedValue({ id: RUN_ID });
      // 查重：不存在（新行）
      prismaMock.fundingEvent.findUnique = vi.fn().mockResolvedValue(null);
    });

    it('归因查询 where 应包含 box.accountId=credentialId（FIX I-2）', async () => {
      const adapter = makeFakeAdapter([{ symbol: SYMBOL, fundingTime: FUNDING_TIME_MS, amount: AMOUNT }]);

      await service.ingestForCredential(CREDENTIAL_ID, adapter, [SYMBOL]);

      // FIX I-2: box 过滤应同时包含 symbol 和 accountId
      expect(prismaMock.run.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            box: { symbol: SYMBOL, accountId: CREDENTIAL_ID },
            startedAt: { lte: FUNDING_TIME_DATE },
          }),
        }),
      );
    });

    it('有归因 Run 时应通过 $transaction 原子写入 FundingEvent + run.update（FIX I-1）', async () => {
      const adapter = makeFakeAdapter([{ symbol: SYMBOL, fundingTime: FUNDING_TIME_MS, amount: AMOUNT }]);

      await service.ingestForCredential(CREDENTIAL_ID, adapter, [SYMBOL]);

      // FIX I-1: 必须使用 $transaction（Prisma 批量事务），确保原子性
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

      // $transaction 应以数组形式调用（批量事务），包含两个操作
      const transactionArg = prismaMock.$transaction.mock.calls[0][0];
      expect(Array.isArray(transactionArg)).toBe(true);
      expect(transactionArg).toHaveLength(2);

      // fundingEvent.create 和 run.update 应作为 $transaction 参数的一部分被构建
      expect(prismaMock.fundingEvent.create).toHaveBeenCalledWith({
        data: {
          credentialId: CREDENTIAL_ID,
          symbol: SYMBOL,
          fundingTime: FUNDING_TIME_DATE,
          amount: AMOUNT,
          attributedRunId: RUN_ID,
        },
      });
      // FIX C1: Run.totalFunding 累计的是「资金费成本」(付出为正)，故 increment = -amount
      expect(prismaMock.run.update).toHaveBeenCalledWith({
        where: { id: RUN_ID },
        data: { totalFunding: { increment: -AMOUNT } },
      });
    });
  });

  describe('场景 2：资金费落在无 Run 空窗 → attributedRunId=null，不更新 Run', () => {
    beforeEach(() => {
      // DB cursor：无历史记录
      prismaMock.fundingEvent.findFirst = vi.fn().mockResolvedValue(null);
      // 查归因 Run：没有匹配的 run
      prismaMock.run.findFirst = vi.fn().mockResolvedValue(null);
      // 查重：不存在（新行）
      prismaMock.fundingEvent.findUnique = vi.fn().mockResolvedValue(null);
    });

    it('归因查询 where 应包含 box.accountId=credentialId（FIX I-2）', async () => {
      const adapter = makeFakeAdapter([{ symbol: SYMBOL, fundingTime: FUNDING_TIME_MS, amount: AMOUNT }]);

      await service.ingestForCredential(CREDENTIAL_ID, adapter, [SYMBOL]);

      // FIX I-2: 无 run 场景下归因查询同样需要 accountId 过滤
      expect(prismaMock.run.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            box: { symbol: SYMBOL, accountId: CREDENTIAL_ID },
          }),
        }),
      );
    });

    it('无归因 Run 时应直接调用 fundingEvent.create（不走 $transaction），不调用 run.update', async () => {
      const adapter = makeFakeAdapter([{ symbol: SYMBOL, fundingTime: FUNDING_TIME_MS, amount: AMOUNT }]);

      await service.ingestForCredential(CREDENTIAL_ID, adapter, [SYMBOL]);

      // 无 run 时直接 create（不需要 $transaction）
      expect(prismaMock.fundingEvent.create).toHaveBeenCalledWith({
        data: {
          credentialId: CREDENTIAL_ID,
          symbol: SYMBOL,
          fundingTime: FUNDING_TIME_DATE,
          amount: AMOUNT,
          attributedRunId: null,
        },
      });

      // 不应走 $transaction，不应更新任何 Run
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.run.update).not.toHaveBeenCalled();
    });
  });

  describe('场景 3：幂等性 — 已存在 FundingEvent 时不重复写入（FIX M-2）', () => {
    beforeEach(() => {
      // DB cursor：无历史记录
      prismaMock.fundingEvent.findFirst = vi.fn().mockResolvedValue(null);
      // 查归因 Run：找到 run
      prismaMock.run.findFirst = vi.fn().mockResolvedValue({ id: RUN_ID });
      // 查重：已存在（模拟第二次 ingest）
      prismaMock.fundingEvent.findUnique = vi.fn().mockResolvedValue({ id: 'existing-event-id' });
    });

    it('发现已存在的 FundingEvent 时，不创建新行，不调用 $transaction，不累加 Run.totalFunding', async () => {
      const adapter = makeFakeAdapter([{ symbol: SYMBOL, fundingTime: FUNDING_TIME_MS, amount: AMOUNT }]);

      await service.ingestForCredential(CREDENTIAL_ID, adapter, [SYMBOL]);

      // FIX M-2: 幂等检查通过时，以下三者均不应被调用
      expect(prismaMock.fundingEvent.create).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.run.update).not.toHaveBeenCalled();
    });
  });

  describe('adapter 无 fetchFundingHistory 时，应直接返回（不抛错）', () => {
    it('无 fetchFundingHistory 的 adapter 不调用任何 DB', async () => {
      const adapterWithout: FundingAdapter = {};

      await service.ingestForCredential(CREDENTIAL_ID, adapterWithout, [SYMBOL]);

      expect(prismaMock.fundingEvent.create).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.run.update).not.toHaveBeenCalled();
    });
  });

  describe('best-effort：单 symbol 失败不阻塞其他 symbol', () => {
    it('第一个 symbol 抛错，第二个仍被处理', async () => {
      const BTC_SYMBOL = 'BTC/USDT';

      // 第一个 symbol fetchFundingHistory 抛错
      const adapter: FundingAdapter = {
        fetchFundingHistory: vi.fn()
          .mockRejectedValueOnce(new Error('network error'))
          .mockResolvedValueOnce([{ symbol: BTC_SYMBOL, fundingTime: FUNDING_TIME_MS, amount: -2.5 }]),
      };

      // DB cursor 查询
      prismaMock.fundingEvent.findFirst = vi.fn().mockResolvedValue(null);
      // 归因 run
      prismaMock.run.findFirst = vi.fn().mockResolvedValue({ id: RUN_ID });
      // 查重：不存在
      prismaMock.fundingEvent.findUnique = vi.fn().mockResolvedValue(null);

      await service.ingestForCredential(CREDENTIAL_ID, adapter, [SYMBOL, BTC_SYMBOL]);

      // BTC 应被成功处理（通过 $transaction）
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('FIX C1 crossing — 付出资金费时 Run.totalFunding 应累计正成本', () => {
    it('付出资金费 amount=-2 → run.update totalFunding increment=+2（正成本，拉低 net）', async () => {
      prismaMock.fundingEvent.findFirst = vi.fn().mockResolvedValue(null);
      prismaMock.run.findFirst = vi.fn().mockResolvedValue({ id: RUN_ID });
      prismaMock.fundingEvent.findUnique = vi.fn().mockResolvedValue(null);

      // 付出资金费：负的现金流
      const PAID_AMOUNT = -2;
      const adapter = makeFakeAdapter([{ symbol: SYMBOL, fundingTime: FUNDING_TIME_MS, amount: PAID_AMOUNT }]);

      await service.ingestForCredential(CREDENTIAL_ID, adapter, [SYMBOL]);

      // 应该以 +2（正成本）increment totalFunding，使 net = realized − fees − 2 降低
      expect(prismaMock.run.update).toHaveBeenCalledWith({
        where: { id: RUN_ID },
        data: { totalFunding: { increment: 2 } },
      });
    });

    it('收取资金费 amount=+1.5 → run.update totalFunding increment=-1.5（负成本，抬高 net）', async () => {
      prismaMock.fundingEvent.findFirst = vi.fn().mockResolvedValue(null);
      prismaMock.run.findFirst = vi.fn().mockResolvedValue({ id: RUN_ID });
      prismaMock.fundingEvent.findUnique = vi.fn().mockResolvedValue(null);

      // 收取资金费：正的现金流
      const RECEIVED_AMOUNT = 1.5;
      const adapter = makeFakeAdapter([{ symbol: SYMBOL, fundingTime: FUNDING_TIME_MS, amount: RECEIVED_AMOUNT }]);

      await service.ingestForCredential(CREDENTIAL_ID, adapter, [SYMBOL]);

      // 应该以 -1.5（负成本）increment totalFunding，使 net = realized − fees − (−1.5) 抬高
      expect(prismaMock.run.update).toHaveBeenCalledWith({
        where: { id: RUN_ID },
        data: { totalFunding: { increment: -1.5 } },
      });
    });
  });

  describe('游标：内存游标避免重复拉取历史', () => {
    it('第二次 ingest 时 sinceMs 应为上次最大 fundingTime，不再查 DB cursor', async () => {
      prismaMock.fundingEvent.findFirst = vi.fn().mockResolvedValue(null);
      prismaMock.run.findFirst = vi.fn().mockResolvedValue({ id: RUN_ID });
      prismaMock.fundingEvent.findUnique = vi.fn().mockResolvedValue(null);

      const adapter = makeFakeAdapter([{ symbol: SYMBOL, fundingTime: FUNDING_TIME_MS, amount: AMOUNT }]);

      // 第一次 ingest
      await service.ingestForCredential(CREDENTIAL_ID, adapter, [SYMBOL]);
      // 第二次 ingest
      await service.ingestForCredential(CREDENTIAL_ID, adapter, [SYMBOL]);

      // fetchFundingHistory 第二次调用时 sinceMs 应为 FUNDING_TIME_MS（内存游标）
      expect(adapter.fetchFundingHistory).toHaveBeenNthCalledWith(2, SYMBOL, FUNDING_TIME_MS);

      // DB cursor 查询（findFirst on fundingEvent）只在首次出现
      expect(prismaMock.fundingEvent.findFirst).toHaveBeenCalledTimes(1);
    });
  });
});
