# GridPilot Core Innovations Explained

> How GridPilot fundamentally differs from exchange-native grid bots — and the engineering behind it.
> *我们与交易所原生网格机器人的本质差异，以及背后的工程设计。*

[简体中文](INNOVATIONS.md) · **English**

An exchange's built-in grid bot is essentially a system that **"places all orders in one batch, leaves them static, and waits for the market to hit them."** GridPilot takes a fundamentally different stance — it **uses software to emulate an experienced live trader**: continuously watching the market and deciding in real time whether to place an order, how to place it, and whether to cancel it. The following breaks down each innovation systematically: which flaw of exchange grids it addresses, how we do it, the technical details, and why it matters for your real money.

> Authoritative implementation reference: [`docs/STRATEGY_SPEC.md`](STRATEGY_SPEC.md) (the strategy specification). The geometric core has a single implementation in `packages/shared-types/src/box-geometry.ts`, shared between frontend and backend.

---

## Table of Contents

1. [The "watch-then-decide" mindset: observe before acting](#1-the-watch-then-decide-mindset-observe-before-acting)
2. [Maker-first / Taker-when-licensed / adverse circuit-break: three-zone dynamic pricing](#2-maker-first--taker-when-licensed--adverse-circuit-break-three-zone-dynamic-pricing)
3. [Chase ordering: real-time pricing and order tracking](#3-chase-ordering-real-time-pricing-and-order-tracking)
4. [Trailing entry: don't predict the bottom, only confirm leaving it](#4-trailing-entry-dont-predict-the-bottom-only-confirm-leaving-it)
5. [Multi-segment price ranges: wherever price goes, the strategy follows](#5-multi-segment-price-ranges-wherever-price-goes-the-strategy-follows)
6. [Box geometry and the d-space single implementation: one codebase for long/short](#6-box-geometry-and-the-d-space-single-implementation-one-codebase-for-longshort)
7. [The stateless target-position algorithm: distributed self-healing](#7-the-stateless-target-position-algorithm-distributed-self-healing)
8. [Unified stop-loss mechanism: tiered reduction + rebound recovery](#8-unified-stop-loss-mechanism-tiered-reduction--rebound-recovery)
9. [Take-profit as "letting the grid finish naturally": box configuration instead of a TP order](#9-take-profit-as-letting-the-grid-finish-naturally-box-configuration-instead-of-a-tp-order)
10. [Side-by-side comparison](#side-by-side-comparison)

---

## 1. The "watch-then-decide" mindset: observe before acting

**Flaw of exchange grids**: All buy and sell orders are placed into the exchange in one batch; once placed, they never move, passively waiting for the market to hit them. If the market doesn't come, they just sit there; if the price is unfavorable, they fill anyway.

**What we do**: Just like a human trader watching the screen, we **observe first and decide afterward on every market update** — whether to place an order, at what price, or whether to cancel an existing one.

**Technical details**: The system is event-driven. On every market tick it re-evaluates the relationship between the current price and the grid's target price:
- Conditions unfavorable (price more expensive than the target buy price, falling into the "circuit-break zone") → refuse to place an order / cancel existing orders and wait;
- Conditions favorable (falling into the "POC zone") → place a Post-Only order at the current best bid to hold position;
- Price has deviated significantly (falling into the "GTC zone") → switch to actively taking, locking in the excess spread.

As a result, **GridPilot does not necessarily have any grid order resting at any given moment** — the exact opposite of an exchange grid that always keeps a screen full of resting orders. In essence, it layers a tier of **automated market-watching decisions** on top of a base grid.

**Value**: It holds position at the current best market price rather than waiting for the market to hit a preset static order; it actively stops when conditions are unfavorable, avoiding fills at the wrong price; and when the price jumps, it can capture extra spread beyond the grid step.

---

## 2. Maker-first / Taker-when-licensed / adverse circuit-break: three-zone dynamic pricing

**The problem to solve**: With leverage and high-frequency grids, fees are the largest hidden cost (Maker ≈0.02% vs. Taker ≈0.05%). Every fill must answer three questions: can it execute as a Maker? Is it worth actively taking? And should we stand down at an unfavorable price?

**What we do**: For each order, we dynamically pick one of three methods based on the deviation of "current price vs. grid target price."

| Zone | Trigger condition | Order method | Fee | Economic rationale |
|------|---------|---------|--------|-----------|
| **Circuit-break zone** | Price moving unfavorably | No order | 0 | No basic profit guarantee, so don't trade |
| **POC zone** | Deviation < threshold | Post-Only pegged one tick inside the opposing quote (buy: bestAsk−tick / sell: bestBid+tick) | **0.02% (Maker)** | Default preference; hold position as a Maker |
| **GTC zone** | Deviation ≥ threshold | Market-take | 0.05% (Taker) | Extra spread > the additional 0.03% paid, so it's worth it |

**Why we insist on Post-Only patience instead of taking at market**: Take Gate.io as an example (Maker 0.02% / Taker 0.05% / step ≈0.1%):

```
Taker fills both sides (100% fill rate): net profit = 0.1% − 0.05%×2 = 0%      ← fees eat the entire step profit
Maker fills both sides (assume 50% cycle completion rate): 0.1% − 0.02%×2 = 0.06% per cycle
                                   expected value = 50% × 0.06% = 0.03% > 0%
```

> **Conclusion**: As long as the cycle-completion probability is > 0, Maker's expected profit beats Taker's — because Taker's per-cycle net profit is already zero, so any Maker fill is pure incremental gain. And in a liquid perpetuals market, a Post-Only order resting at best bid/ask typically fills within 1-2 seconds (see STRATEGY_SPEC §7.7) — the cost of waiting is far lower than intuition suggests.

**The economic model of GTC**: By design, the GTC threshold = `ExcessProfitMultiplier (default 2.0) × takerFee (0.05%)` = 0.1%, roughly 3.3× the "worthwhile minimum threshold" (takerFee − makerFee = 0.03%), leaving a conservative margin; the current implementation takes a fixed default of 0.1%, with the parameter linkage still to be wired up (see STRATEGY_SPEC §7.8 / §13.1 for implementation status). Only when the extra spread profit truly exceeds the additional fee paid do we license a take.

**Value**: Routine fills execute at low Maker cost; we only actively take to lock in excess profit when the extra spread genuinely covers the additional fee; and we spend nothing when conditions are unfavorable. Maker handles low-cost routine fills, GTC handles excess profit on large deviations, and the circuit-break zone handles standing down — the three complement each other to cover every scenario.

---

## 3. Chase ordering: real-time pricing and order tracking

**Flaw of exchange grids**: Orders rest at the fixed theoretical grid price; if the price never reaches it, they wait idle forever, and even if the price grazes past, they may not fill.

**What we do**: Instead of waiting for the price to fall to the theoretical price before ordering, we **repeatedly pre-place orders chasing the best bid/ask**, striving for a Maker fill — or a take on a large deviation.

**Technical details**:
- **Pegged one tick inside the opposing quote**: A POC order's price ≠ the theoretical grid price; it is `min(theoretical price, bestAsk − tick)` when buying and `max(theoretical price, bestBid + tick)` when selling — when the spread is wider than one tick, this sits inside the book as the best quote on the market, so the next incoming market order fills us as a Maker, at a price no worse than — and usually better than — the theoretical price (extra gain). Pegging this way also avoids the Post-Only rejections that resting directly at bestBid/bestAsk would suffer from slight price moves.
- **Tracking amendment**: Every tick we check — ① POC→GTC upgrade (fleeting opportunities take priority to be taken); ② if the order book shifts beyond the `current price × 0.02%` amendment threshold, cancel and re-place to keep the best quote; ③ if it enters the circuit-break zone, cancel and wait.
- **Serialized execution**: At any moment there is at most one active grid order Pending; order fill/cancel events themselves also trigger "recompute target position → chase ordering," without waiting for the next tick, so we never miss the best moment.
- **Stop-loss priority**: Once the stop-loss process begins, all in-progress grid ordering is immediately abandoned to ensure no new position is opened.

**Value**: It turns "wait for the price to come" into "chase the best price," maximizing both the Maker fill rate and the price advantage of fills.

**Why chasing carries no downside risk**: When price reaches the theoretical grid price, the odds of it continuing in the favorable versus unfavorable direction are roughly fifty-fifty. If it keeps going our way, the system chases and fills at an even better price — every tick of improvement is pure gain. If it turns against us, as long as it hasn't crossed the next grid line, the system can still fill at the original theoretical price — breaking even with a static grid. Under a standard gambler's-ruin model, the probability of truly missing the fill — crossing the next line before ever getting a price back — is negligible. In other words, "extra profit is free; missing it costs nothing": chasing produces **incremental gains (alpha) with no downside** — buys are only ever cheaper, sells only ever more profitable than a static grid. By the same token, the strategy is insensitive to network latency: it profits by *waiting*, not *racing*, so no server room or leased line is needed; at worst, latency steals part of the bonus — never the grid's underlying profit.

---

## 4. Trailing entry: don't predict the bottom, only confirm leaving it

**Flaw of exchange grids**: They open a position the instant the price enters the range, often "getting stuck at a high after entering" and buying ever deeper into losses on the way down.

**What we do**: When the price falls into the range from above, we **don't open immediately**; we first track the extreme on the loss side, then enter only after the price rebounds from the extreme by a confirmed amount (`TrailingCallbackRate`, default 0.2%).

**Technical details**:
- Track the extreme (the low for long / the high for short); the trigger price = `extreme × (1 ± callback rate)`, and once the rebound meets the bar we enter RUNNING.
- If the price keeps crossing past the activation price (further toward the take-profit side) → the trailing window closes and we return to listening; if it crosses the liquidation line (and a stop-loss zone is configured) → go straight into the stop-loss process (LIQUIDATING).
- **Clever touch**: if the price enters the range moving **toward the take-profit direction** (the loss side already behind it), we **skip trailing and go straight to RUNNING** — here the entry cost is closer to the liquidation side, the per-grid take-profit is higher, and waiting would only forgo gains.

**Value**: In essence this is "don't predict the bottom, only confirm you've already left it." No matter how far it has fallen, as long as a rebound is confirmed we enter safely, dodging the role of catching the falling top.

---

## 5. Multi-segment price ranges: wherever price goes, the strategy follows

**Flaw of exchange grids**: A fixed single range; once the price moves out of the range it becomes ineffective or gets stuck at full position.

**What we do**: We pre-configure multiple **non-overlapping** price ranges (boxes); a "range manager" monitors the price in real time, activating whichever segment the price enters while the rest stay dormant.

**Technical details**:
- **Single-runner invariant**: At any moment at most one range's bot runs; the manager keeps listening and is responsible for activation / stopping / re-activation.
- **Activation window**: Activation only happens when the price is between the `activationPrice` and the liquidation line (toward the loss side) — starting toward the take-profit side leaves little take-profit room and large loss risk, giving negative expected value.
- **Direction awareness**: Entering toward the loss direction uses trailing entry; entering toward the take-profit direction goes straight to RUNNING.
- **Crash recovery**: After a crash and restart, if a position still exists, skip trailing entry and take over directly in RUNNING; on startup, first clean up any leftover algorithmic orders from the previous round to avoid two overlapping sets of conditional orders misfiring.

**Value**: For instruments with wide oscillation, the strategy always operates within whichever range the price lands in, rather than being locked into a single range.

---

## 6. Box geometry and the d-space single implementation: one codebase for long/short

**Common engineering flaw**: Most implementations write long/short as two mirrored sets of logic — many branches, error-prone, hard to maintain.

**What we do**: Geometric computation is done in a normalized **d-space** (the signed distance from the take-profit side, with the loss direction positive), and the directional branch **appears only in two mapping functions**:

```
LONG:  d = takeProfitPrice − price
SHORT: d = price − takeProfitPrice
```

Zone determination, target position, activation window, trailing entry, and FSM triggers are **all single-implemented in d-space, with short automatically mirroring long**. The box is anchored at the **take-profit side** and unfolds four structural lines toward the loss direction: take-profit line → main grid zone → full-position line → isolation band → stop-loss zone start → stop-loss zone → liquidation line.

**The economic motivation of the isolation band (not just a buffer)**: It is a "dead zone" between the full-position line and the stop-loss zone that **prevents the main grid's add-to-position and the stop-loss's reduce-position from triggering alternately when the price oscillates at the boundary and repeatedly paying two-sided fees**. Brief price noise cannot trigger both sets of logic at once, greatly reducing wasteful trades.

**Value**: One codebase covers both long and short with zero mirrored branches = fewer bugs, easier to audit; the isolation band directly saves the fee leakage from boundary oscillation.

---

## 7. The stateless target-position algorithm: distributed self-healing

**Flaw of exchange grids / naive implementations**: They rely on a locally maintained order/position history. Network jitter, partial fills, concurrency races, and crash-restarts all cause the local state to "not match" the exchange's actual position, requiring manual cleanup.

**What we do**: The target position is **determined entirely by the current price, with no dependence on any historical state**.

```
target position = f(current price)                      ← stateless derivation
amount to operate = target position − exchange's latest actual position     ← fetched in real time
```

**Technical details**:
- Every tick only asks "how much position should I hold at the current price," then compares it against the **real-time-queried** true position and corrects directly — no tracing history, no maintaining a local order book.
- **Position double-insurance**: passively receiving position pushes + **actively pulling** the latest position once after each fill (the two WS channels may be out of sync; the active pull prevents over-buying/over-selling on a stale position).
- **Asymmetric buffering**: selling is based on the "position that should be held" (easier to trigger, locking profit faster), while buying is based on the "position that should be bought" (stricter, must deviate by more than one grid), accumulating a positive skew.

**Value**: No matter how long the crash, how many hours offline, or even if the user manually changed the position — as long as the program restarts and gets the current price, it instantly computes the proper position and corrects it, with **no operational burden of "state got dirty and needs manual cleanup."** This sidesteps distributed-system inconsistency at the root.

---

## 8. Unified stop-loss mechanism: tiered reduction + rebound recovery

**Flaw of exchange grids**: The stop-loss is often a single price that closes everything in one shot; on a brief breakdown that then rebounds, you've already been fully liquidated and can only re-enter and pay another round of fees.

**What we do**: Below the main grid we set a "stop-loss buffer zone" and **reduce position in tiered decrements** rather than cutting it all at once; moreover, the stop-loss zone and the main grid **share the same position-computation function**, with no need for special conditional-order maintenance logic.

**Technical details**:
- `computeTargetPosition(price, config)` covers every zone of the box (main grid / isolation band / stop-loss zone / out-of-bounds); within the stop-loss zone, `targetHoldSize` decreases as the price falls, and each grid the price drops triggers one reduction, with no need for special ping-pong flipping.
- **Fallback conditional order**: Only at the liquidation line do we place a "close-all" conditional order as the last line of defense, guarding against dynamic-ordering failure in extreme cases (offline / exchange outage).
- **Rebound recovery**: If a brief breakdown then rebounds, the residual position directly benefits, saving the fees of re-entering.
- **No-stop-loss mode**: When `stopLossGridCount = 0`, no stop-loss zone is set, and on going out of bounds it holds full position and toughs it out (suitable for users with strong conviction in the range).

**Value**: It turns "one-shot stop-loss" into "smooth tiered reduction + retained rebound recoverability," reducing slippage and pointless re-entry costs.

---

## 9. Take-profit as "letting the grid finish naturally": box configuration instead of a TP order

**Flaw of exchange grids**: Take-profit / stop-loss are separate add-on orders, with logic decoupled from the grid.

**What we do**: Take-profit is not a hard close but **letting the grid finish naturally** — as the price moves toward the take-profit direction, the grid keeps closing and the position gradually empties; when the last grid is closed and the price crosses the take-profit line, the bot recognizes the task is naturally complete and exits.

**Technical details**: The take-profit condition = "price reaches the take-profit side AND position is zero." **Active take-profit** simply requires adjusting `takeProfitPrice` to bring the take-profit line closer to the current price (lower it for long / raise it for short); the grid closes its last share near the new take-profit line and exits — effectively using the take-profit line as a "dynamic take-profit line."

**Value**: The profit of every grid toward the take-profit direction is earned, never prematurely giving up profit within the range; a single configuration item precisely controls the exit price, with no need for extra take-profit-order logic.

---

## Side-by-side comparison

| Dimension | Exchange-native grid | GridPilot |
|------|----------------|-----------|
| **Ordering mindset** | Batch static orders, leave them static and wait to be hit | Event-driven watching; observe before deciding; not necessarily any resting order at a given moment |
| **Execution quality** | Static orders only ever earn the grid-line price; the excess spread in a jump passes by | Three-zone pricing: POC fills as low-cost Maker / GTC locks excess spread / circuit-break refuses |
| **Order price** | Fixed theoretical grid price | Pegged one tick inside the opposing quote to sit top-of-book, with chase re-pegging to stay competitive |
| **Entry timing** | Open immediately on entering the range | Trailing entry confirms a rebound, avoiding getting stuck at the top |
| **Market adaptation** | Fixed single range | Multiple non-overlapping ranges; activate whichever segment the price enters |
| **Long/short implementation** | Two mirrored sets of logic | d-space single implementation, short auto-mirrors long |
| **Consistency** | Relies on local state, easily dirty, needs manual cleanup | Stateless + real-time position, self-heals across crash/disconnect |
| **Stop-loss** | Single price, close all in one shot | Tiered decremental reduction + liquidation-line fallback conditional + rebound recovery |
| **Take-profit** | Separate TP order | Grid finishes naturally; adjust takeProfitPrice for dynamic take-profit |

> ⚠️ Grid trading is not guaranteed profit: a one-sided downtrend still produces unrealized losses, and leverage amplifies risk. The above is strategy design, not investment advice. Please understand the strategy first and validate thoroughly with small capital or on a testnet.

---

## 中文版 / Chinese version

完整中文版见 [INNOVATIONS.md](INNOVATIONS.md).
