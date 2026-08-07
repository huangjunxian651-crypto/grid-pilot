import { describe, it, expect } from "vitest";
import {
  toDistance,
  toPrice,
  deriveBoxLines,
  computeTargetPosition,
  whichZone,
  whichZoneFromDistances,
  buildBoundaryDistances,
  priceToGridIndex,
  gridIndexToBuyPrice,
  gridIndexToSellPrice,
  priceToStopLossIndex,
  stopLossIndexToBuyPrice,
  stopLossIndexToSellPrice,
  validateBoxGeometry,
  predictActions,
  minOrderSizeRequirement,
  type BoxGeometryConfig,
  type BoxTargetConfig,
} from "../box-geometry";

const LONG_CONFIG: BoxGeometryConfig = {
  takeProfitPrice: 2800,
  direction: "LONG",
  mainGridCount: 10,
  mainGridStep: 10,
  stopLossGridCount: 4,
  stopLossGridStep: 5,
  isolationStep: 10,
};

const SHORT_CONFIG: BoxGeometryConfig = { ...LONG_CONFIG, direction: "SHORT" };

describe("toDistance / toPrice", () => {
  it("LONG: d = takeProfitPrice - price，互为反函数", () => {
    expect(toDistance(2750, LONG_CONFIG)).toBe(50);
    expect(toPrice(50, LONG_CONFIG)).toBe(2750);
  });

  it("SHORT: d = price - takeProfitPrice，互为反函数", () => {
    expect(toDistance(2850, SHORT_CONFIG)).toBe(50);
    expect(toPrice(50, SHORT_CONFIG)).toBe(2850);
  });

  it("止盈端 d=0，亏损方向 d>0（两个方向）", () => {
    expect(toDistance(2800, LONG_CONFIG)).toBe(0);
    expect(toDistance(2800, SHORT_CONFIG)).toBe(0);
    expect(toDistance(2700, LONG_CONFIG)).toBeGreaterThan(0);
    expect(toDistance(2900, SHORT_CONFIG)).toBeGreaterThan(0);
  });
});

describe("deriveBoxLines", () => {
  it("LONG: 四条结构线沿价格向下展开", () => {
    const lines = deriveBoxLines(LONG_CONFIG);
    // mainGridDepth = 10*10 = 100; isolationEndDepth = 110; boxDepth = 110 + 4*5 = 130
    expect(lines.mainGridDepth).toBe(100);
    expect(lines.isolationEndDepth).toBe(110);
    expect(lines.boxDepth).toBe(130);
    expect(lines.takeProfitPrice).toBe(2800);
    expect(lines.fullPositionPrice).toBe(2700);
    expect(lines.stopLossStartPrice).toBe(2690);
    expect(lines.liquidationPrice).toBe(2670);
    expect(lines.boxHighPrice).toBe(2800);
    expect(lines.boxLowPrice).toBe(2670);
  });

  it("SHORT: 同配置结构线沿价格向上展开（镜像）", () => {
    const lines = deriveBoxLines(SHORT_CONFIG);
    expect(lines.takeProfitPrice).toBe(2800);
    expect(lines.fullPositionPrice).toBe(2900);
    expect(lines.stopLossStartPrice).toBe(2910);
    expect(lines.liquidationPrice).toBe(2930);
    expect(lines.boxHighPrice).toBe(2930);
    expect(lines.boxLowPrice).toBe(2800);
  });

  it("镜像性质：d 空间标量与方向无关", () => {
    const longLines = deriveBoxLines(LONG_CONFIG);
    const shortLines = deriveBoxLines(SHORT_CONFIG);
    expect(shortLines.mainGridDepth).toBe(longLines.mainGridDepth);
    expect(shortLines.isolationEndDepth).toBe(longLines.isolationEndDepth);
    expect(shortLines.boxDepth).toBe(longLines.boxDepth);
  });

  it("stopLossGridCount=0 时 boxDepth = mainGridDepth + isolationStep", () => {
    const lines = deriveBoxLines({ ...LONG_CONFIG, stopLossGridCount: 0 });
    expect(lines.boxDepth).toBe(110);
    expect(lines.liquidationPrice).toBe(2690);
  });

  it("isolationStep=0 时 fullPositionPrice === stopLossStartPrice", () => {
    const lines = deriveBoxLines({ ...LONG_CONFIG, isolationStep: 0 });
    expect(lines.fullPositionPrice).toBe(lines.stopLossStartPrice);
    expect(lines.boxDepth).toBe(100 + 4 * 5); // 120
  });
});

const LONG_TARGET: BoxTargetConfig = { ...LONG_CONFIG, mainGridPortionSize: 1 };
const SHORT_TARGET: BoxTargetConfig = { ...SHORT_CONFIG, mainGridPortionSize: 1 };

describe("computeTargetPosition - LONG 回归（数值与旧 computeLong 逐点一致）", () => {
  // 旧实现基线：apps/api/src/modules/trading-engine/strategy/compute-target-position.ts computeLong
  // takeProfitPrice=2800 count=10 step=10 portion=1 slCount=4 slStep=5 iso=10
  // fullPosition=2700 stopLossStart=2690 liquidation=2670 baseSize=10 slPortion=2.5

  it("PROFIT_EXIT: price >= 2800 → 0/0, gridIndex -1", () => {
    const r = computeTargetPosition(2800, LONG_TARGET);
    expect(r.zone).toBe("PROFIT_EXIT");
    expect(r.targetBoughtSize).toBe(0);
    expect(r.targetHoldSize).toBe(0);
    expect(r.gridIndex).toBe(-1);

    const above = computeTargetPosition(2801, LONG_TARGET);
    expect(above.zone).toBe("PROFIT_EXIT");
    expect(above.gridIndex).toBe(-1);
  });

  it("MAIN: price=2755 → grids=4, tB=4, tH=5", () => {
    const r = computeTargetPosition(2755, LONG_TARGET);
    expect(r.zone).toBe("MAIN");
    expect(r.gridIndex).toBe(4);
    expect(r.targetBoughtSize).toBe(4);
    expect(r.targetHoldSize).toBe(5);
  });

  it("MAIN 网格线上: price=2750 → grids=5, tB=5, tH=6", () => {
    const r = computeTargetPosition(2750, LONG_TARGET);
    expect(r.gridIndex).toBe(5);
    expect(r.targetBoughtSize).toBe(5);
    expect(r.targetHoldSize).toBe(6);
  });

  it("满仓线上: price=2700 (d=mainGridDepth) → ISOLATION, tB=tH=baseSize", () => {
    const r = computeTargetPosition(2700, LONG_TARGET);
    expect(r.zone).toBe("ISOLATION");
    expect(r.targetBoughtSize).toBe(10);
    expect(r.targetHoldSize).toBe(10);
  });

  it("ISOLATION: price=2695 → tB=tH=baseSize=10", () => {
    const r = computeTargetPosition(2695, LONG_TARGET);
    expect(r.zone).toBe("ISOLATION");
    expect(r.targetBoughtSize).toBe(10);
    expect(r.targetHoldSize).toBe(10);
  });

  it("STOP_LOSS: price=2682 → slGrids=floor(12/5)=2, tB=5, tH=7.5, gridIndex=12", () => {
    const r = computeTargetPosition(2682, LONG_TARGET);
    expect(r.zone).toBe("STOP_LOSS");
    expect(r.targetBoughtSize).toBe(5);
    expect(r.targetHoldSize).toBe(7.5);
    expect(r.gridIndex).toBe(12);
  });

  it("LOSS_EXIT: price=2670 → 0/0, gridIndex=count+slCount=14", () => {
    const r = computeTargetPosition(2670, LONG_TARGET);
    expect(r.zone).toBe("LOSS_EXIT");
    expect(r.targetBoughtSize).toBe(0);
    expect(r.targetHoldSize).toBe(0);
    expect(r.gridIndex).toBe(14);
  });

  it("slCount=0: 跨过 boxDepth 仍满仓（现行为）", () => {
    const config = { ...LONG_TARGET, stopLossGridCount: 0 };
    // boxDepth = 110 → liquidationPrice = 2690
    const isolation = computeTargetPosition(2695, config);
    expect(isolation.zone).toBe("ISOLATION");
    expect(isolation.targetBoughtSize).toBe(10);
    expect(isolation.targetHoldSize).toBe(10);

    const r = computeTargetPosition(2689, config);
    expect(r.zone).toBe("LOSS_EXIT");
    expect(r.targetBoughtSize).toBe(10);
    expect(r.targetHoldSize).toBe(10);
    expect(r.gridIndex).toBe(10);
  });
});

describe("computeTargetPosition - 镜像性质（SHORT 在 toPrice(d) 处恒等于 LONG）", () => {
  const SAMPLE_DISTANCES = [
    -5, 0, 0.5, 3, 10, 15, 50, 95, 99.999, 100, 105, 110, 112, 115, 125, 129.999, 130, 200,
  ];

  it("任意 d：target/zone/gridIndex 完全一致", () => {
    for (const d of SAMPLE_DISTANCES) {
      const long = computeTargetPosition(toPrice(d, LONG_TARGET), LONG_TARGET);
      const short = computeTargetPosition(toPrice(d, SHORT_TARGET), SHORT_TARGET);
      expect(short.zone, `d=${d}`).toBe(long.zone);
      expect(short.gridIndex, `d=${d}`).toBe(long.gridIndex);
      expect(short.targetBoughtSize, `d=${d}`).toBeCloseTo(long.targetBoughtSize, 9);
      expect(short.targetHoldSize, `d=${d}`).toBeCloseTo(long.targetHoldSize, 9);
    }
  });

  it("随机配置×随机 d 的镜像性质（200 组）", () => {
    for (let trial = 0; trial < 200; trial++) {
      const count = 2 + Math.floor(Math.random() * 20);
      const step = 1 + Math.random() * 50;
      const slCount = Math.floor(Math.random() * 5);
      const cfg = {
        takeProfitPrice: 1000 + Math.random() * 4000,
        mainGridCount: count,
        mainGridStep: step,
        mainGridPortionSize: 0.1 + Math.random(),
        stopLossGridCount: slCount,
        stopLossGridStep: slCount > 0 ? 0.5 + Math.random() * 10 : 0,
        isolationStep: Math.random() * 20,
      };
      const longCfg: BoxTargetConfig = { ...cfg, direction: "LONG" };
      const shortCfg: BoxTargetConfig = { ...cfg, direction: "SHORT" };
      const depth = deriveBoxLines(longCfg).boxDepth;
      const d = -depth * 0.1 + Math.random() * depth * 1.3;
      const long = computeTargetPosition(toPrice(d, longCfg), longCfg);
      const short = computeTargetPosition(toPrice(d, shortCfg), shortCfg);
      const label = `trial=${trial} d=${d}`;
      expect(short.zone, label).toBe(long.zone);
      expect(short.gridIndex, label).toBe(long.gridIndex);
      expect(short.targetBoughtSize, label).toBeCloseTo(long.targetBoughtSize, 6);
      expect(short.targetHoldSize, label).toBeCloseTo(long.targetHoldSize, 6);
    }
  });

  it("SHORT 隔离带：价格上穿满仓线进入隔离带不再产生集中加空（tB 不超过 baseSize 且连续）", () => {
    // 旧 bug：SHORT 在 takeProfitPrice 上方（旧名 mainGridTop）tB 跳变到 baseSize。
    // 新几何：满仓线下方一格 tB = count-1 …… 隔离带内 tB = baseSize，
    // 但满仓线处 MAIN 侧 tB 已是 baseSize → 无跳变。
    const justBelowFull = computeTargetPosition(toPrice(99.999, SHORT_TARGET), SHORT_TARGET);
    const atFull = computeTargetPosition(toPrice(100, SHORT_TARGET), SHORT_TARGET);
    const inIsolation = computeTargetPosition(toPrice(105, SHORT_TARGET), SHORT_TARGET);
    expect(justBelowFull.targetBoughtSize).toBe(9);
    expect(atFull.targetBoughtSize).toBe(10);
    expect(inIsolation.targetBoughtSize).toBe(10);
    expect(inIsolation.zone).toBe("ISOLATION");
  });
});

describe("whichZone（旧 which-zone.ts LONG 行为回归 + 镜像）", () => {
  it("LONG: 边界线索引与旧实现一致", () => {
    // 旧 buildBoundaryLines LONG: [2800, 2790..2700(10条), 2690(iso), 2685..2670(4条)] 共16条
    expect(whichZone(2805, LONG_CONFIG)).toBe(0);   // d<=0
    expect(whichZone(2795, LONG_CONFIG)).toBe(1);   // 第一格内
    expect(whichZone(2700, LONG_CONFIG)).toBe(10);  // 满仓线上（d=100 恰好命中 ds[10]）
    expect(whichZone(2660, LONG_CONFIG)).toBe(16);  // 越过全部 16 条线
  });

  it("镜像性质：whichZone(toPrice(d)) 与方向无关", () => {
    for (const d of [-1, 0, 5, 55, 100, 105, 110, 120, 130, 150]) {
      expect(whichZone(toPrice(d, SHORT_CONFIG), SHORT_CONFIG), `d=${d}`)
        .toBe(whichZone(toPrice(d, LONG_CONFIG), LONG_CONFIG));
    }
  });

  it("whichZoneFromDistances 与 whichZone 等价（缓存路径）", () => {
    const ds = buildBoundaryDistances(LONG_CONFIG);
    expect(whichZoneFromDistances(toDistance(2755, LONG_CONFIG), ds))
      .toBe(whichZone(2755, LONG_CONFIG));
  });
});

describe("priceToGridIndex / gridIndexTo*Price（旧 index-utils LONG 回归 + 镜像）", () => {
  it("LONG 回归：旧 index-utils.spec 的基准值", () => {
    expect(priceToGridIndex(2755, LONG_CONFIG)).toBe(4);
    expect(priceToGridIndex(2800, LONG_CONFIG)).toBe(0);
    expect(priceToGridIndex(2805, LONG_CONFIG)).toBeNull();
    expect(priceToGridIndex(2695, LONG_CONFIG)).toBe(10);     // 隔离区
    expect(priceToGridIndex(2685, LONG_CONFIG)).toBeNull();   // 止损区
    expect(gridIndexToBuyPrice(0, LONG_CONFIG)).toBe(2790);
    expect(gridIndexToSellPrice(0, LONG_CONFIG)).toBe(2800);
    expect(gridIndexToBuyPrice(10, LONG_CONFIG)).toBe(2700);  // 隔离区（旧行为）
    expect(gridIndexToSellPrice(10, LONG_CONFIG)).toBe(2690);
  });

  it("SHORT 镜像：买卖角色互换（BUY=减仓边，SELL=加仓边）", () => {
    expect(priceToGridIndex(toPrice(45, SHORT_CONFIG), SHORT_CONFIG)).toBe(4);
    expect(gridIndexToSellPrice(0, SHORT_CONFIG)).toBe(2810); // 加空：远端
    expect(gridIndexToBuyPrice(0, SHORT_CONFIG)).toBe(2800);  // 平空：近端
  });

  it("止损索引映射 LONG 回归 + SHORT 镜像", () => {
    expect(priceToStopLossIndex(2682, LONG_CONFIG)).toBe(2);
    expect(priceToStopLossIndex(2695, LONG_CONFIG)).toBe(4);  // 隔离区
    expect(priceToStopLossIndex(2755, LONG_CONFIG)).toBeNull();
    expect(stopLossIndexToSellPrice(2, LONG_CONFIG)).toBe(2680);
    expect(stopLossIndexToBuyPrice(2, LONG_CONFIG)).toBe(2685);
    expect(priceToStopLossIndex(toPrice(118, SHORT_CONFIG), SHORT_CONFIG)).toBe(2);
    expect(stopLossIndexToBuyPrice(2, SHORT_CONFIG)).toBe(2920);  // 平空（减仓）
    expect(stopLossIndexToSellPrice(2, SHORT_CONFIG)).toBe(2915); // 加空
  });

  it("越界索引抛错（gridIndex 与 stopLossIndex 各自的消息字段）", () => {
    expect(() => gridIndexToBuyPrice(-1, LONG_CONFIG)).toThrow("Invalid gridIndex");
    expect(() => gridIndexToSellPrice(11, LONG_CONFIG)).toThrow("Invalid gridIndex");
    expect(() => stopLossIndexToBuyPrice(-1, LONG_CONFIG)).toThrow("Invalid stopLossIndex");
    expect(() => stopLossIndexToSellPrice(5, LONG_CONFIG)).toThrow("Invalid stopLossIndex");
  });
});

describe("validateBoxGeometry", () => {
  it("合法 LONG/SHORT 配置通过", () => {
    expect(validateBoxGeometry(LONG_CONFIG).valid).toBe(true);
    expect(validateBoxGeometry(SHORT_CONFIG).valid).toBe(true);
  });

  it("LONG 清算线 ≤ 0 拒绝；同配置 SHORT 不受此限", () => {
    const tight = { ...LONG_CONFIG, takeProfitPrice: 120 }; // boxDepth=130 → liquidation=-10
    expect(validateBoxGeometry(tight).valid).toBe(false);
    expect(validateBoxGeometry({ ...tight, direction: "SHORT" as const }).valid).toBe(true);
  });

  it("止损深度超过总深度 1/5 拒绝", () => {
    const fat = { ...LONG_CONFIG, stopLossGridCount: 10, stopLossGridStep: 10 };
    expect(validateBoxGeometry(fat).valid).toBe(false);
  });

  it("activationPrice 必须落在主网格内（两个方向）", () => {
    expect(validateBoxGeometry({ ...LONG_CONFIG, activationPrice: 2750 }).valid).toBe(true);
    expect(validateBoxGeometry({ ...LONG_CONFIG, activationPrice: 2695 }).valid).toBe(false);
    expect(validateBoxGeometry({ ...SHORT_CONFIG, activationPrice: 2850 }).valid).toBe(true);
    expect(validateBoxGeometry({ ...SHORT_CONFIG, activationPrice: 2905 }).valid).toBe(false);
  });

  it("启用止损时 isolationStep<=0 报错", () => {
    const r = validateBoxGeometry({ direction: "LONG", takeProfitPrice: 2800, mainGridCount: 235, mainGridStep: 2.5, stopLossGridCount: 4, stopLossGridStep: 2.5, isolationStep: 0 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /isolationStep/.test(e))).toBe(true);
  });
  it("启用止损且 isolationStep>0 通过", () => {
    const r = validateBoxGeometry({ direction: "LONG", takeProfitPrice: 2800, mainGridCount: 235, mainGridStep: 2.5, stopLossGridCount: 4, stopLossGridStep: 2.5, isolationStep: 2.5 });
    expect(r.valid).toBe(true);
  });
  it("无止损时 isolationStep=0 通过", () => {
    const r = validateBoxGeometry({ direction: "LONG", takeProfitPrice: 2800, mainGridCount: 235, mainGridStep: 2.5, stopLossGridCount: 0, stopLossGridStep: 0, isolationStep: 0 });
    expect(r.valid).toBe(true);
  });
});

describe("predictActions（LONG 回归 + SHORT 镜像）", () => {
  const baseInput = {
    ...LONG_TARGET,
    price: 2755,
    positionQty: 4,
  };

  it("LONG 回归：actions 覆盖主网格 11 条线 + 止损 4 条线，价格降序", () => {
    const r = predictActions(baseInput);
    expect(r.actions.length).toBe(11 + 4);
    expect(r.actions[0].price).toBe(2800);
    expect(r.actions.map((a) => a.price)).toEqual(
      [...r.actions.map((a) => a.price)].sort((a, b) => b - a),
    );
  });

  it("LONG 回归：fsmTriggers = {takeProfit: 2800, enterStopLoss: 2700, liquidate: 2670}", () => {
    const r = predictActions(baseInput);
    expect(r.fsmTriggers).toEqual({ takeProfit: 2800, enterStopLoss: 2700, liquidate: 2670 });
  });

  it("LONG 回归：price=2755 持仓 4 → nearestSell 在 2770，nearestBuy 在 2750", () => {
    // nearestSell 推导：候选线 d=40(2760) 处 tH(d=39.9)=4，持仓 4 不足以触发；
    // d=30(2770) 处 tH(d=29.9)=3，4 > 3 → 卖 1 份。与旧实现遍历顺序一致。
    const r = predictActions(baseInput);
    expect(r.nearestSell?.price).toBe(2770);
    expect(r.nearestSell?.side).toBe("SELL");
    expect(r.nearestSell?.qty).toBeCloseTo(1, 9);
    expect(r.nearestBuy?.price).toBe(2750);
    expect(r.nearestBuy?.side).toBe("BUY");
  });

  it("SHORT 镜像：positionQty 传有符号负值，nearestBuy=平空在止盈侧、nearestSell=加空在亏损侧", () => {
    const r = predictActions({
      ...SHORT_TARGET,
      price: toPrice(45, SHORT_TARGET), // 2845，d=45，空头 4 份
      positionQty: -4,
    });
    // LONG 对应：nearestSell(reduce)@d=30 → SHORT nearestBuy(reduce)@toPrice(30)=2830
    expect(r.nearestBuy?.price).toBe(2830);
    expect(r.nearestBuy?.side).toBe("BUY");
    // LONG 对应：nearestBuy(add)@d=50 → SHORT nearestSell(add)@2850
    expect(r.nearestSell?.price).toBe(2850);
    expect(r.nearestSell?.side).toBe("SELL");
    expect(r.fsmTriggers).toEqual({ takeProfit: 2800, enterStopLoss: 2900, liquidate: 2930 });
  });

  it("镜像性质：SHORT 的 actions 与 LONG 在 d 空间逐条对应（side 角色互换）", () => {
    const long = predictActions(baseInput);
    const short = predictActions({
      ...SHORT_TARGET,
      price: toPrice(45, SHORT_TARGET),
      positionQty: -4,
    });
    expect(short.actions.length).toBe(long.actions.length);
    const flip = (s: string) => (s === "BUY" ? "SELL" : s === "SELL" ? "BUY" : "HOLD");
    // LONG actions 价格降序 = d 升序；SHORT actions 价格降序 = d 降序 → 反转后逐条比
    const shortByDepthAsc = [...short.actions].reverse();
    for (let i = 0; i < long.actions.length; i++) {
      expect(toDistance(shortByDepthAsc[i].price, SHORT_TARGET), `i=${i}`)
        .toBeCloseTo(toDistance(long.actions[i].price, LONG_TARGET), 9);
      expect(shortByDepthAsc[i].side, `i=${i}`).toBe(flip(long.actions[i].side));
      expect(shortByDepthAsc[i].qty, `i=${i}`).toBeCloseTo(long.actions[i].qty, 9);
    }
  });
});

describe("characterization: 定价映射全 index 快照（重构必须逐一不变）", () => {
  function sweep(config: BoxGeometryConfig) {
    const grid: Array<{ i: number; buy: number; sell: number }> = [];
    for (let i = 0; i <= config.mainGridCount; i++) {
      grid.push({ i, buy: gridIndexToBuyPrice(i, config), sell: gridIndexToSellPrice(i, config) });
    }
    const stopLoss: Array<{ i: number; buy: number; sell: number }> = [];
    for (let i = 0; i <= config.stopLossGridCount; i++) {
      stopLoss.push({ i, buy: stopLossIndexToBuyPrice(i, config), sell: stopLossIndexToSellPrice(i, config) });
    }
    return { grid, stopLoss };
  }

  it("LONG 全 index 价格快照", () => {
    expect(sweep(LONG_CONFIG)).toMatchInlineSnapshot(`
      {
        "grid": [
          {
            "buy": 2790,
            "i": 0,
            "sell": 2800,
          },
          {
            "buy": 2780,
            "i": 1,
            "sell": 2790,
          },
          {
            "buy": 2770,
            "i": 2,
            "sell": 2780,
          },
          {
            "buy": 2760,
            "i": 3,
            "sell": 2770,
          },
          {
            "buy": 2750,
            "i": 4,
            "sell": 2760,
          },
          {
            "buy": 2740,
            "i": 5,
            "sell": 2750,
          },
          {
            "buy": 2730,
            "i": 6,
            "sell": 2740,
          },
          {
            "buy": 2720,
            "i": 7,
            "sell": 2730,
          },
          {
            "buy": 2710,
            "i": 8,
            "sell": 2720,
          },
          {
            "buy": 2700,
            "i": 9,
            "sell": 2710,
          },
          {
            "buy": 2700,
            "i": 10,
            "sell": 2690,
          },
        ],
        "stopLoss": [
          {
            "buy": 2675,
            "i": 0,
            "sell": 2670,
          },
          {
            "buy": 2680,
            "i": 1,
            "sell": 2675,
          },
          {
            "buy": 2685,
            "i": 2,
            "sell": 2680,
          },
          {
            "buy": 2690,
            "i": 3,
            "sell": 2685,
          },
          {
            "buy": 2670,
            "i": 4,
            "sell": 2690,
          },
        ],
      }
    `);
  });

  it("SHORT 全 index 价格快照", () => {
    expect(sweep(SHORT_CONFIG)).toMatchInlineSnapshot(`
      {
        "grid": [
          {
            "buy": 2800,
            "i": 0,
            "sell": 2810,
          },
          {
            "buy": 2810,
            "i": 1,
            "sell": 2820,
          },
          {
            "buy": 2820,
            "i": 2,
            "sell": 2830,
          },
          {
            "buy": 2830,
            "i": 3,
            "sell": 2840,
          },
          {
            "buy": 2840,
            "i": 4,
            "sell": 2850,
          },
          {
            "buy": 2850,
            "i": 5,
            "sell": 2860,
          },
          {
            "buy": 2860,
            "i": 6,
            "sell": 2870,
          },
          {
            "buy": 2870,
            "i": 7,
            "sell": 2880,
          },
          {
            "buy": 2880,
            "i": 8,
            "sell": 2890,
          },
          {
            "buy": 2890,
            "i": 9,
            "sell": 2900,
          },
          {
            "buy": 2910,
            "i": 10,
            "sell": 2900,
          },
        ],
        "stopLoss": [
          {
            "buy": 2930,
            "i": 0,
            "sell": 2925,
          },
          {
            "buy": 2925,
            "i": 1,
            "sell": 2920,
          },
          {
            "buy": 2920,
            "i": 2,
            "sell": 2915,
          },
          {
            "buy": 2915,
            "i": 3,
            "sell": 2910,
          },
          {
            "buy": 2930,
            "i": 4,
            "sell": 2910,
          },
        ],
      }
    `);
  });
});

describe("minOrderSizeRequirement", () => {
  it("按 minNotional/boxLowPrice 折算再按 stepSize 向上取整（用户给出的原始例子）", () => {
    // 20 / 1800 = 0.01111...，stepSize=0.01 向上取整 → 0.02（不是未取整的 0.0111，也不是向下取整的 0.01）
    const min = minOrderSizeRequirement(1800, { minQty: 0.001, minNotional: 20, stepSize: 0.01 });
    expect(min).toBeCloseTo(0.02, 10);
  });

  it("minQty 比 minNotional 折算值更高时取 minQty，再按 stepSize 向上取整", () => {
    // minNotional 折算 = 20/2000 = 0.01；minQty=0.015 更高 → 取 0.015，按 stepSize=0.01 向上取整 → 0.02
    const min = minOrderSizeRequirement(2000, { minQty: 0.015, minNotional: 20, stepSize: 0.01 });
    expect(min).toBeCloseTo(0.02, 10);
  });

  it("理论最小值恰好是 stepSize 整数倍时不多取整一级", () => {
    // 20/2000 = 0.01，stepSize=0.01 的整数倍，向上取整应仍为 0.01
    const min = minOrderSizeRequirement(2000, { minQty: 0.001, minNotional: 20, stepSize: 0.01 });
    expect(min).toBeCloseTo(0.01, 10);
  });

  it("stepSize 为 0（交易所未提供步长信息）时不取整，直接返回理论最小值", () => {
    const min = minOrderSizeRequirement(1800, { minQty: 0.001, minNotional: 20, stepSize: 0 });
    expect(min).toBeCloseTo(20 / 1800, 10);
  });

  it("minNotional 为 0（交易所无此约束，如 Gate.io）时只看 minQty", () => {
    const min = minOrderSizeRequirement(1800, { minQty: 0.01, minNotional: 0, stepSize: 0.001 });
    expect(min).toBeCloseTo(0.01, 10);
  });
});
