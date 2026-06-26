# GridPilot

> ETH/USDT perpetual futures **dynamic grid** trading platform · compatible with Binance / Gate.io / OKX
> Makes real-time decisions like a trader watching the charts, instead of placing orders and walking away.

[简体中文](README.md) · [繁體中文](README.zh-TW.md) · **English** · [日本語](README.ja.md) · [Español](README.es.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md) · [한국어](README.ko.md) · [ไทย](README.th.md) · [Tiếng Việt](README.vi.md)

---

## 📸 Interface Preview

| Dashboard · Overview | Fees & Rebates |
|:---:|:---:|
| ![GridPilot Dashboard](docs/screenshots/en/dashboard.png) | ![Fees & Rebates](docs/screenshots/en/fees.png) |

> Deep teal brand theme · Space Grotesk / IBM Plex fonts · 12 built-in languages, with the interface switching along with the language.

## 🎯 Why Grid Trading?

Grid trading slices a price range into multiple "grid lines": it buys each time the price drops one grid and sells each time it rises one grid—**repeatedly buying low and selling high in choppy markets, turning volatility itself into profit**. It does not predict whether prices will go up or down; it only earns the spread from back-and-forth swings within a range, which makes it especially suited to markets with no clear trend that oscillate up and down.

Compared with "buy and hold": buy-and-hold only profits if the price ultimately rises; grid trading keeps accumulating small profits one by one during sideways consolidation. The cost is the need to continuously manage orders and control risk—and that is precisely the part GridPilot automates for you.

> ⚠️ Grid trading is not a guaranteed win: you can still take unrealized losses during a one-sided decline, and leverage amplifies risk. Make sure you understand the strategy before committing funds.

## 🚀 Our 5 Key Innovations Over Exchange-Native Grids

The grid bots built into exchanges are essentially "place a batch of orders once, leave them untouched, and wait for the market to come hit them." GridPilot's core difference is **using software to simulate an experienced chart-watching trader**:

| Dimension | Exchange-Native Grid | GridPilot |
|------|----------------|-----------|
| **Order placement** | Static batch orders that never move once placed | Automated chart-watching: on every market update it re-evaluates before dynamically placing/amending/canceling orders, and may have no open orders at any given moment |
| **Fees** | No distinction between active and passive fills | Three-zone pricing: Maker orders in the POC zone (saves ~0.03%), licensed taker fills in the GTC zone to lock in excess profit, and order rejection in the circuit-breaker zone |
| **Entry timing** | Opens a position immediately upon entering the range | Trailing entry: when the price enters the range it first trails the low, and only builds the position after confirming a rebound, avoiding opening at a high and getting stuck |
| **Stop-loss** | Closes the entire position at a single price in one shot | Layered algorithmic-order buffer for staged reduction; if the price briefly breaks down then rebounds, the residual position benefits directly, saving the fees of rebuilding |
| **Market adaptation** | A fixed single range | Multiple non-overlapping ranges; whichever range the price enters becomes active while the rest stay dormant |

1. **Observe-then-decide chart-watching mindset**: the system evaluates the relationship between the current price and the target price only when it receives new market data—if conditions are unfavorable it holds off and waits, and only when conditions are favorable does it position at the optimal price. When the price jumps sharply it can even capture extra spread beyond the grid step.
2. **Maker-first / Taker-licensed / unfavorable circuit-breaker**: by default it places Post-Only Maker orders to capture lower fees; it only actively takes when the extra profit outweighs the taker cost and the opportunity is fleeting; when the current price is more expensive than the target buy price it rejects the order outright, avoiding buying high and selling low.
3. **Trailing entry**: avoids getting stuck by opening at the top.
4. **Layered algorithmic-order stop-loss**: preserves the ability to recover on a rebound.
5. **Multi-segment price ranges**: wherever the price goes, the strategy follows.

> See [`docs/INNOVATIONS.en.md`](docs/INNOVATIONS.en.md) for a point-by-point comparison against exchange-native grids; see [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md) for the complete strategy rationale.

## ✨ Feature Overview

- **Multi-segment price ranges**: pre-configure multiple non-overlapping ranges (e.g. 2000–2600, 2600–3200); whichever range the price enters becomes active
- **Trailing entry**: trails the low and builds the position only after confirming a rebound
- **Three-zone dynamic pricing**: Maker in the POC zone, locking excess profit in the GTC zone, order rejection in the circuit-breaker zone
- **Layered stop-loss buffer**: multiple tiers of algorithmic conditional orders below the main grid for staged reduction
- **Real-time WebSocket push**: Ticker / fills / state-machine events synced to the frontend in real time
- **Multi-exchange support**: a unified adapter interface compatible with Binance, Gate.io, and OKX
- **Multilingual interface**: 12 built-in languages

## 💰 Understand the Fees, Save Money With an Invite Code at Sign-Up (sponsored by rebateto.me)

Fees are charged by the exchange, and **GridPilot takes not a single cent**. On the same trade, a maker order (Maker) is ≈0.02% and a taker order (Taker) is ≈0.05%. Under leverage and high-frequency grids, fees get quietly amplified and add up to no small amount over time—GridPilot places Maker orders for you by default, saving about 0.03% per trade, and only actively takes when the opportunity is fleeting.

Going further: **when you register with an exchange, filling in a rebate code lets you get back roughly 20% of the fees you've already paid over the long term (40% for Gate), credited automatically**—effectively giving every trade an extra discount.

> ⚠️ You can only register once per exchange, and the rebate can only be bound at registration. **Existing accounts cannot add it later—this is the only chance.**

**Sponsored by [rebateto.me](https://rebateto.me)**, which aggregates and maintains the rebate registration entry points for each exchange. Please use the following invite codes when registering:

| Exchange | Invite Code | Rebate Rate |
|--------|--------|----------|
| Binance | `fanwo20` | 20% |
| OKX | `fangeiwo` | 20% |
| Gate.io | `fangeiwo` | 40% |

> When registering via the app, remember to fill in the invite code manually—miss it and you won't get the rebate. Each ID can open only one account per exchange.

## 📦 Installation

**Prerequisites**: Node.js ≥ 20, pnpm ≥ 9, Docker

### Option 1: One-Command Full Stack via Docker (recommended for self-hosting)

```bash
git clone <repo-url> && cd grid-pilot
cp .env.example .env
# Generate an encryption key and fill it into ENCRYPTION_KEY in .env
openssl rand -base64 32
# Bring up PostgreSQL + Redis + API + Web in one command (database migrations run automatically)
docker compose --profile full up --build -d
```

After startup, visit http://localhost:3300 .

> Without `--profile full`, `docker compose up` only starts the PostgreSQL + Redis infrastructure for local development.

### Option 2: Local Installation (recommended for development)

```bash
git clone <repo-url> && cd grid-pilot
pnpm install
cp .env.example .env        # adjust ports/keys as needed
pnpm dev                    # starts the docker infrastructure first, then API + Web
```

| Service | Address | Config |
|------|------|--------|
| Frontend | http://localhost:3300 | `WEB_PORT` / `WEB_HOST` |
| Backend API | http://localhost:3301 | `API_PORT` / `API_HOST` |
| PostgreSQL | localhost:25432 | `DB_PORT` |
| Redis | localhost:26379 | `REDIS_PORT` |

Start individually:

```bash
pnpm dev:infra        # PostgreSQL + Redis only
pnpm dev:api          # backend only
pnpm dev:web          # frontend only
pnpm dev:skip-infra   # API + Web, skipping docker
```

## 🕹️ Usage Guide

1. **Connect an exchange**: fill in your API Key/Secret in settings. **Grant only futures trading permission—never enable withdrawal permission.**
2. **Configure the grid**: choose the trading pair and price range, and set the main grid count, step, quantity per grid, leverage, stop-loss buffer, and trailing-entry parameters.
3. **Start the bot**: enter trailing entry → running, and the frontend displays market data, open orders, fills, and the state machine in real time.
4. **Monitor and wind down**: triggering take-profit winds down by stopping further additions; triggering the stop-loss buffer reduces the position in stages.

Key parameters:

| Parameter | Description |
|------|------|
| `takeProfitPrice` | Take-profit price (the take-profit boundary of the box) |
| `mainGridCount` / `mainGridStep` | Main grid count / step per grid (USDT) |
| `mainGridPortionSize` | Order quantity per grid |
| `leverage` | Leverage multiplier |
| `stopLossGridCount` / `stopLossGridStep` | Stop-loss buffer zone count / step |
| `activationPrice` / `trailingCallbackRate` | Trailing-entry activation price / callback rate |
| `excessProfitMultiplier` | GTC zone trigger multiplier (excess-profit threshold) |

See [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md) for the complete set of parameters.

## ⚠️ Important Notes

- **Risk disclaimer**: futures trading is highly leveraged and high-risk, and may lead to the loss of all your principal. This project is an open-source trading tool and **does not constitute any investment advice**; it is not responsible for your profits or losses. Please validate thoroughly with small amounts or an exchange testnet first.
- **API permissions**: enable only futures trading permission—**do not** enable withdrawal permission.
- **Single-runner constraint**: for the same trading pair on the same exchange account, only one bot can run at a time.
- **Rebate timing**: the invite code can only be bound at registration; existing accounts cannot add it later.
- **Key security**: `ENCRYPTION_KEY` is used to encrypt exchange credentials—be sure to use a randomly generated strong key and keep it safe.
- **Port conflicts**: if your local 3300/3301 ports are occupied by `pnpm dev`, they will conflict with the Docker full-stack containers; stop the local processes before starting the containers, or change the port configuration in `.env`.

## 🏗️ Tech Stack & Architecture

| Layer | Technology |
|------|------|
| Frontend | Next.js 16 · React 19 · Tailwind CSS v4 · Zustand · React Query · Recharts |
| Backend | NestJS 10 · Prisma 5 · BullMQ · Socket.IO |
| Infrastructure | PostgreSQL 16 · Redis 7 · Docker Compose |
| Shared | TypeScript · pnpm Workspaces · Turborepo |

```
apps/web/          # Next.js frontend (dark theme, 12 languages)
apps/api/          # NestJS backend
packages/shared-types/  # types shared between frontend and backend
docs/              # STRATEGY_SPEC.md (strategy spec) · ARCHITECTURE.md (component mapping)
docker-compose.yml # default infrastructure; --profile full for the full stack
```

**Strategy state machine**: `TRAILING_ENTRY → RUNNING → LIQUIDATING → LIQUIDATED`, where `RUNNING` can branch to `TAKE_PROFIT`; operational branches include `PAUSED` (can be reset via `USER_RESUME`), `CANCELLED`, and `HOLD`.

**Development commands**:

```bash
pnpm dev          # start all services in one command
pnpm build        # build
pnpm test         # test
pnpm lint         # lint
```

**Database** (local development):

```bash
cd apps/api
pnpm prisma migrate dev    # run migrations
pnpm prisma studio         # view data
```

## Documentation Index

| Document | Description |
|------|------|
| [`docs/INNOVATIONS.en.md`](docs/INNOVATIONS.en.md) | Core innovations explained (point-by-point vs exchange-native grids) |
| [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md) | Complete strategy specification (authoritative reference) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Index mapping code components to spec sections |
| [`docs/fees-and-funding.md`](docs/fees-and-funding.md) | Fees and funding-rate explanation |
