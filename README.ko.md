# GridPilot

> ETH/USDT 무기한 계약 **동적 그리드** 트레이딩 플랫폼 · Binance / Gate.io / OKX 호환

**거래소의 "걸어두고 방치하는" 정적 그리드를, 24시간 난판을 지켜보는 트레이더로 업그레이드합니다——매 틱마다 다시 의사결정합니다.**

- 🧠 **동적 시세 감시 주문**: 일괄 주문을 한 번 걸어두고 운에 맡기지 않습니다——시세가 갱신될 때마다 다시 판단한 후 주문/정정/취소하고, 가격이 크게 점프하면 그리드 스텝을 넘어서는 추가 차익까지 포착합니다
- 💸 **거래당 약 0.03% 수수료 절약**: 기본적으로 Post-Only Maker 주문을 걸어 더 낮은 수수료율을 취하고, 초과 이익이 테이커 비용을 넘을 때만 특별히 테이커 체결을 허용하며, 가격이 불리하면 곧바로 주문을 거부합니다
- 🎯 **추적 진입, 고점에서 오픈하지 않음**: 가격이 구간에 진입하면 먼저 저점을 추적하고, 반등을 확인한 후에야 포지션을 잡아 진입하자마자 물리는 것을 방지합니다
- 🛡️ **계층형 손절 완충**: 가격이 잠깐 깨졌다가 반등하면 잔여 포지션이 그대로 이익을 봅니다——전량 청산 후 재구축하는 수수료가 절약됩니다
- 🧭 **다중 구간 자동 추종**: 겹치지 않는 여러 구간을 미리 설정해 두면, 가격이 들어온 구간의 전략이 활성화됩니다

[简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [Español](README.es.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md) · **한국어** · [ไทย](README.th.md) · [Tiếng Việt](README.vi.md)

---

## 📸 인터페이스 미리보기

| 대시보드 · 개요 | 수수료 및 리베이트 |
|:---:|:---:|
| ![GridPilot 대시보드](docs/screenshots/ko/dashboard.png) | ![수수료 및 리베이트](docs/screenshots/ko/fees.png) |

> 딥 틸(deep teal) 브랜드 테마 · Space Grotesk / IBM Plex 폰트 · 12개 언어 내장, 언어 전환에 따라 인터페이스가 함께 바뀝니다.

## 🎯 왜 그리드 트레이딩인가?

그리드 트레이딩은 하나의 가격 구간을 여러 개의 "그리드 라인"으로 나누어, 가격이 한 칸 떨어질 때마다 매수하고 한 칸 오를 때마다 매도합니다——**박스권 장세에서 반복적으로 고점 매도·저점 매수를 하며 변동성 그 자체를 수익으로 바꿉니다**. 등락을 예측하지 않고, 구간 내 왕복 변동의 차익만 취하기 때문에 명확한 추세 없이 위아래로 진동하는 시장에 특히 적합합니다.

"매수 후 보유(Buy and Hold)"와 비교하면: 매수 후 보유는 최종적으로 가격이 올랐을 때만 수익을 냅니다. 그리드는 횡보·진동 장세에서 자잘한 이익을 꾸준히 쌓아갑니다. 그 대가로 주문을 지속적으로 관리하고 리스크를 통제해야 하는데——바로 이 부분을 GridPilot이 당신을 대신해 자동화합니다.

> ⚠️ 그리드 트레이딩이 무조건 수익을 보장하지는 않습니다: 일방적 하락장에서는 여전히 평가손실이 발생하고, 레버리지는 리스크를 증폭시킵니다. 투입하기 전에 먼저 전략을 충분히 이해하세요.

## 🚀 거래소 네이티브 그리드 대비 우리의 5가지 혁신

거래소에 내장된 그리드 봇은 본질적으로 "한 번에 일괄 주문을 걸어두고 그대로 둔 채, 시장이 와서 체결되기를 기다리는" 방식입니다. GridPilot의 핵심 차별점은 **프로그램으로 경험 많은 시세 감시 트레이더를 시뮬레이션하는 것**입니다:

| 항목 | 거래소 네이티브 그리드 | GridPilot |
|------|----------------|-----------|
| **주문 방식** | 일괄 정적 주문, 한 번 걸면 이동하지 않음 | 자동화된 시세 감시: 시세가 갱신될 때마다 다시 판단한 후 동적으로 주문/정정/취소, 임의의 시점에 주문이 없을 수도 있음 |
| **수수료** | 능동/수동 체결을 구분하지 않음 | 3구간 가격 책정: POC 구간은 Maker 주문(약 0.03% 절약), GTC 구간은 특별히 테이커 체결을 허용해 초과 이익 확보, 서킷브레이커 구간은 주문 거부 |
| **진입 타이밍** | 구간 진입 즉시 포지션 오픈 | 추적 진입: 가격이 구간에 들어오면 먼저 저점을 추적하고, 반등을 확인한 후에야 포지션을 잡아 오픈하자마자 고점에 물리는 것을 방지 |
| **손절** | 단일 가격대에서 한 번에 청산 | 계층형 알고리즘 주문으로 완충하며 단계적 감축, 잠깐 깨졌다가 반등하면 잔여 포지션이 그대로 이익을 보고 재구축 수수료를 절감 |
| **시세 적응** | 고정된 단일 구간 | 겹치지 않는 다중 구간, 가격이 들어온 구간만 활성화되고 나머지는 휴면 |

1. **먼저 관찰하고 나중에 결정하는 시세 감시 사고방식**: 시스템은 시세를 받을 때마다 현재가와 목표가의 관계를 판단합니다——조건이 불리하면 손을 멈추고 관망하고, 유리할 때만 최적가에 자리를 잡으며, 가격이 크게 점프할 때는 그리드 스텝을 넘어서는 추가 차익까지 포착할 수 있습니다.
2. **Maker 우선 / Taker 특별 허용 / 불리 시 서킷브레이커**: 기본적으로 Post-Only Maker 주문을 걸어 더 낮은 수수료율을 취하고, 추가 이익이 테이커 체결 비용을 넘어서고 기회가 순식간에 사라질 때만 능동적으로 테이커 체결을 하며, 현재가가 목표 매수가보다 비쌀 때는 곧바로 주문을 거부해 비싸게 사서 싸게 파는 것을 방지합니다.
3. **추적 진입**: 고점 오픈으로 물리는 것을 방지합니다.
4. **계층형 알고리즘 주문 손절**: 반등 회복 능력을 유지합니다.
5. **다중 가격 구간**: 가격이 어디로 가든 전략이 따라갑니다.

> 전체 전략 원리는 [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md)를 참고하세요.

## ✨ 기능 개요

- **다중 가격 구간**: 겹치지 않는 여러 구간(예: 2000–2600, 2600–3200)을 미리 설정, 가격이 들어온 구간을 활성화
- **추적 진입**: 저점을 추적하고 반등을 확인한 후에야 포지션 진입
- **3구간 동적 가격 책정**: POC 구간 Maker, GTC 구간 초과 이익 확보, 서킷브레이커 구간 주문 거부
- **계층형 손절 완충**: 메인 그리드 하단에 여러 단계의 알고리즘 조건부 주문으로 단계적 감축
- **실시간 WebSocket 푸시**: Ticker / 체결 / 상태 머신 이벤트를 프런트엔드에 실시간 동기화
- **다중 거래소 지원**: 통합 어댑터 인터페이스, Binance / Gate.io / OKX 호환
- **다국어 인터페이스**: 12개 언어 내장

## 💰 수수료를 이해하고, 가입 시 초대 코드로 절약하기 (스폰서 rebateto.me)

수수료는 거래소가 부과하며, **GridPilot은 한 푼도 떼지 않습니다**. 동일한 거래에서 메이커(Maker)는 약 0.02%, 테이커(Taker)는 약 0.05%입니다. 레버리지와 고빈도 그리드 환경에서는 수수료가 소리 없이 증폭되어, 쌓이면 결코 적지 않습니다——GridPilot은 기본적으로 당신을 대신해 Maker 주문을 걸어 매 건당 약 0.03%를 절약하고, 기회가 순식간에 사라질 때만 능동적으로 테이커 체결을 합니다.

한 걸음 더 나아가: **거래소에 가입할 때 리베이트 코드 하나를 입력하면, 이미 지불한 수수료의 약 20%(Gate는 40%)를 장기적으로 자동 환급받을 수 있습니다**——매 거래마다 추가 할인을 받는 셈입니다.

> ⚠️ 거래소마다 한 번만 가입할 수 있고, 리베이트는 가입 시에만 연동할 수 있으며, **기존 계정은 소급 적용 불가——이것이 유일한 기회입니다**.

**스폰서 [rebateto.me](https://rebateto.me)** 가 각 거래소의 리베이트 가입 경로를 모아 관리합니다. 가입 시 다음 초대 코드를 사용하세요:

| 거래소 | 초대 코드 | 리베이트 비율 |
|--------|--------|----------|
| Binance | `fanwo20` | 20% |
| OKX | `fangeiwo` | 20% |
| Gate.io | `fangeiwo` | 40% |

> 앱으로 가입할 때는 초대 코드를 수동으로 입력하는 것을 잊지 마세요——누락하면 환급을 받지 못합니다. 신분증 하나당 거래소별로 계정 하나만 개설할 수 있습니다.

## 📦 설치

**사전 의존성**: Node.js ≥ 20, pnpm ≥ 9, Docker

### 방법 1: Docker 원클릭 풀스택 (셀프 호스팅 권장)

```bash
git clone https://github.com/QuantiaAI/grid-pilot.git && cd grid-pilot
cp .env.example .env
# 암호화 키를 생성하여 .env 의 ENCRYPTION_KEY 에 입력
openssl rand -base64 32
# 원클릭으로 PostgreSQL + Redis + API + Web 기동(데이터베이스 마이그레이션 자동 실행)
docker compose --profile full up --build -d
```

기동 후 http://localhost:3300 에 접속하세요.

> `--profile full` 없이 `docker compose up` 을 실행하면 PostgreSQL + Redis 인프라만 기동되어 로컬 개발용으로 사용됩니다.

### 방법 2: 로컬 설치 (개발 권장)

```bash
git clone https://github.com/QuantiaAI/grid-pilot.git && cd grid-pilot
pnpm install
cp .env.example .env        # 필요에 따라 포트 조정; ENCRYPTION_KEY 는 openssl rand -base64 32 의 출력으로 설정
pnpm --filter @gridpilot/api exec prisma generate       # Prisma Client 생성(postinstall 이 비활성화되어 있어 필수 단계)
pnpm dev:infra              # PostgreSQL + Redis 기동
pnpm exec dotenv -e .env -- pnpm --filter @gridpilot/api exec prisma migrate deploy # 최초 설치 시에만: 데이터베이스 마이그레이션 적용
pnpm dev:skip-infra         # API + Web 기동
```

> `prisma generate` / `migrate deploy` 단계는 최초 설치 시 한 번만 필요합니다; 이후에는 `pnpm dev` 만 실행하면 모든 서비스가 기동됩니다.

| 서비스 | 주소 | 설정 항목 |
|------|------|--------|
| 프런트엔드 | http://localhost:3300 | `WEB_PORT` / `WEB_HOST` |
| 백엔드 API | http://localhost:3301 | `API_PORT` / `API_HOST` |
| PostgreSQL | localhost:25432 | `DB_PORT` |
| Redis | localhost:26379 | `REDIS_PORT` |

개별 기동:

```bash
pnpm dev:infra        # PostgreSQL + Redis 만
pnpm dev:api          # 백엔드만
pnpm dev:web          # 프런트엔드만
pnpm dev:skip-infra   # API + Web, docker 건너뛰기
```

## 🕹️ 사용 설명

1. **거래소 연결**: 설정에서 API Key/Secret 을 입력합니다. **계약 거래 권한만 부여하고, 출금 권한은 절대 켜지 마세요.**
2. **그리드 설정**: 거래쌍과 가격 구간을 선택하고, 메인 그리드 칸 수, 스텝, 칸당 수량, 레버리지, 손절 완충, 추적 진입 파라미터를 설정합니다.
3. **봇 시작**: 추적 진입 → 실행으로 진입하면, 프런트엔드에서 시세, 주문, 체결, 상태 머신을 실시간으로 표시합니다.
4. **모니터링 및 마무리**: 익절이 트리거되면 추가 매수를 중단하고 마무리하며, 손절 완충이 트리거되면 단계적으로 감축합니다.

핵심 파라미터:

| 파라미터 | 설명 |
|------|------|
| `takeProfitPrice` | 익절가(박스권 익절단 경계) |
| `mainGridCount` / `mainGridStep` | 메인 그리드 칸 수 / 칸당 스텝(USDT) |
| `mainGridPortionSize` | 칸당 주문 수량 |
| `leverage` | 레버리지 배수 |
| `stopLossGridCount` / `stopLossGridStep` | 손절 완충 구간 칸 수 / 스텝 |
| `activationPrice` / `trailingCallbackRate` | 추적 진입 활성화가 / 콜백 폭 |
| `excessProfitMultiplier` | GTC 구간 트리거 배수(초과 이익 임계값) |

전체 파라미터는 [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md)를 참고하세요.

## ⚠️ 주의 사항

- **리스크 면책**: 계약 거래는 고레버리지·고위험으로 원금 전액 손실로 이어질 수 있습니다. 본 프로젝트는 오픈소스 트레이딩 도구로, **어떠한 투자 조언도 구성하지 않으며** 손익에 대해 책임지지 않습니다. 먼저 소액 자금이나 거래소 테스트넷으로 충분히 검증하세요.
- **API 권한**: 계약 거래 권한만 켜고, 출금 권한은 **켜지 마세요**.
- **단일 runner 제약**: 동일한 거래소 계정의 동일한 거래쌍에 대해, 동시에 하나의 봇만 실행할 수 있습니다.
- **리베이트 타이밍**: 초대 코드는 가입 시에만 연동할 수 있고, 기존 계정은 소급 입력이 불가능합니다.
- **키 보안**: `ENCRYPTION_KEY` 는 거래소 자격 증명을 암호화하는 데 사용되므로, 반드시 무작위로 생성한 강력한 키를 사용하고 안전하게 보관하세요.
- **포트 충돌**: 로컬 3300/3301 포트가 `pnpm dev` 에 의해 점유되면 Docker 풀스택 컨테이너와 충돌하므로, 먼저 로컬 프로세스를 중지한 뒤 컨테이너를 기동하거나 `.env` 의 포트 설정을 변경하세요.

## 🏗️ 기술 스택 및 아키텍처

| 계층 | 기술 |
|------|------|
| 프런트엔드 | Next.js 16 · React 19 · Tailwind CSS v4 · Zustand · React Query · Recharts |
| 백엔드 | NestJS 10 · Prisma 5 · BullMQ · Socket.IO |
| 인프라 | PostgreSQL 16 · Redis 7 · Docker Compose |
| 공유 | TypeScript · pnpm Workspaces · Turborepo |

```
apps/web/          # Next.js 프런트엔드(다크 테마, 12개 언어)
apps/api/          # NestJS 백엔드
packages/shared-types/  # 프런트·백엔드 공유 타입
docs/              # STRATEGY_SPEC.md(전략 규격) · ARCHITECTURE.md(컴포넌트 매핑)
docker-compose.yml # 기본 인프라; --profile full 풀스택
```

**전략 상태 머신**: `TRAILING_ENTRY → RUNNING → LIQUIDATING → LIQUIDATED`, `RUNNING` 은 `TAKE_PROFIT` 로 분기 가능; 운영 분기에는 `PAUSED`(`USER_RESUME` 로 복귀 가능), `CANCELLED`, `HOLD` 가 포함됩니다.

**개발 명령어**:

```bash
pnpm dev          # 모든 서비스 원클릭 기동
pnpm build        # 빌드
pnpm test         # 테스트
pnpm lint         # Lint
```

**데이터베이스**(로컬 개발):

```bash
cd apps/api
pnpm prisma migrate dev    # 마이그레이션 실행
pnpm prisma studio         # 데이터 조회
```

## 문서 색인

| 문서 | 설명 |
|------|------|
| [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md) | 전체 전략 규격 명세서(권위 있는 참조) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 코드 컴포넌트에서 규격 챕터로의 매핑 색인 |
| [`docs/fees-and-funding.md`](docs/fees-and-funding.md) | 수수료 및 펀딩비 설명 |
