# Pulse Protocol V1 Master Specification

**Version:** 1.0 (Protocol Knowledge Freeze)  
**Status:** Ratified  
**Author:** Manus AI  
**Scope:** Single Source of Truth for Pulse Protocol V1 Development

---

## A. Architecture

Pulse Protocol V1 implements a **Shared Logic + Isolated Vault** architecture to facilitate a fully collateralized, Continuous Scoring Market (CSM) without external Liquidity Providers.

### Core Architecture Components

The protocol is composed of four Core Contracts and several supporting modules:

1. **PulseFactory (Core Contract):** The sole entry point for creating Views. It acts as the global Registry and maintains the immutable snapshot of rules (FeeConfig, PriceEngine version, etc.) at the time of View creation.
2. **TradingEngine (Core Contract):** The shared execution layer. It handles all `buy` and `sell` operations, manages internal Position Accounting (per-View, non-transferable), records time-driven TWAP snapshots, and acts as the central router for a trade's lifecycle.
3. **FeeManager (Core Contract):** Handles protocol fee accounting using a Pull-over-Push model. It records obligations per ViewID but performs no active token transfers.
4. **SettlementManager (Core Contract):** Reads the finalized TWAP from the TradingEngine to determine the settlement result (For Wins, Against Wins, or Draw) and processes user claims.
5. **MarketVault (Infrastructure):** A per-View isolated custody contract. It holds all user collateral (ERC20) for a specific View. It is strictly limited to `deposit`, `withdraw`, and `settle` operations.
6. **MarketVaultFactory (Infrastructure):** Deploys MarketVault instances exclusively upon request from the PulseFactory.
7. **PriceEngine (Infrastructure):** A stateless, pure computation module that implements the CSM pricing algorithm. It calculates the Pulse Index and generates buy/sell quotes.
8. **Libraries:** `MathLibrary` (safe arithmetic, overflow protection, full-precision `mulDiv`) and `TWAPLibrary` (time-driven snapshot logic).

### Data, Fund, and State Flow

- **Creation Flow:** User → `PulseFactory.createView()` → `MarketVaultFactory.deployVault()` → Vault created → View registered in Factory.
- **Trade Flow (Buy):** User → `TradingEngine.buy()` → `PriceEngine.quoteBuy()` (computes shares) → `FeeManager.recordFee()` → `MarketVault.deposit()` (pulls ERC20 from user).
- **Trade Flow (Sell):** User → `TradingEngine.sell()` → `PriceEngine.quoteSell()` (computes collateral) → `FeeManager.recordFee()` → `MarketVault.withdraw()` (pushes ERC20 to user).
- **Settlement Flow:** Time reaches `EndTime` → Anyone calls `TradingEngine.lockMarket()` (halts trading, finalizes TWAP) → Anyone calls `SettlementManager.settleMarket()` (reads TWAP, sets result) → Users call `SettlementManager.claimReward()` → `MarketVault.settle()` (pushes ERC20 to winner).

---

## B. Design Principles

All development MUST adhere to the following confirmed principles:

1. **One View = One Vault:** Every View has its own dedicated MarketVault. Funds are strictly isolated; a vulnerability or extreme imbalance in one View cannot affect any other View.
2. **Shared TradingEngine:** All Views share a single TradingEngine instance to minimize deployment costs and gas overhead.
3. **Internal Position Accounting:** Position Shares are purely internal accounting records within the TradingEngine (`mapping(viewId => mapping(user => mapping(side => shares)))`). They are NOT ERC20/ERC1155 tokens and cannot be transferred or approved.
4. **Vaults Never Hold Positions:** The MarketVault only tracks and holds the ERC20 collateral. It has zero knowledge of Position Shares, Pulse Index, or market rules.
5. **Pull-over-Push Fee:** Fees are recorded as balances in the FeeManager. The protocol never pushes fee transfers during a trade. Creators, Treasury, and Team must actively call `claim` functions to withdraw their fees.
6. **Atomic Creation:** The creation of a View, deployment of its Vault, and registration in the Factory occur in a single atomic transaction. Any failure reverts the entire process.
7. **Rule Snapshot & Immutable Token Binding:** Upon View creation, the FeeConfig, PriceEngine version, and collateral token are permanently frozen in the Factory's `ViewRecord`. Future protocol upgrades do not alter the economic rules of existing Views.
8. **Upgrade Boundary:** PriceEngine, FeeManager, and SettlementManager logic can be upgraded for *future* Views. However, the Factory Registry, historical View data, and existing Vault ownership are strictly immutable.
9. **Least Privilege:** Modules only possess the permissions necessary for their specific function. For example, PriceEngine cannot transfer funds; TradingEngine cannot directly modify settlement results.
10. **Checks-Effects-Interactions (CEI) & Reentrancy Protection:** All state-changing functions must strictly follow the CEI pattern and utilize `nonReentrant` guards.
11. **Invariant Driven Design:** Protocol accounting must always be less than or equal to actual asset backing. The invariant `min(ForSupply, AgainstSupply) <= VaultReserve` must hold true after every trade.
12. **Production DeFi Security Standard:** Correctness and Security take absolute precedence over Gas Optimization.

---

## C. Module Specification

### 1. PulseFactory
- **Responsibilities:** Sole entry point for `createView()`. Deploys Vaults via MarketVaultFactory. Maintains the global immutable Registry of `ViewRecord`.
- **Forbidden:** Handling trades, calculating prices, managing fees, or altering View parameters post-creation.
- **State Changes:** Appends to the Registry mapping. Emits `ViewCreated`.

### 2. TradingEngine
- **Responsibilities:** Executes `buy` and `sell`. Manages internal Position Accounting. Updates the Pulse Index. Calls `TWAPLibrary` to record snapshots. Manages the Market Status machine (`ACTIVE` → `LOCKED` → `SETTLEMENT` → `CLAIMABLE`).
- **Forbidden:** Holding collateral funds. Modifying prices without PriceEngine. Altering settlement logic.
- **Invariants:** Cannot execute trades if status != `ACTIVE`. Cannot lock market before `EndTime`.

### 3. FeeManager
- **Responsibilities:** Records fee obligations via `recordFee()`. Manages `claimCreatorFee()`, `claimTreasuryFee()`, and `claimTeamFee()`. Fees are strictly segregated by `viewId`.
- **Forbidden:** Initiating active token transfers during trades. Modifying trade logic.

### 4. SettlementManager
- **Responsibilities:** Reads finalized TWAP to determine outcome (For Wins, Against Wins, Draw). Processes user `claimReward()` requests.
- **Forbidden:** Modifying historical market rules. Altering user Positions.
- **Invariants:** Cannot settle a market that is not `LOCKED`. Cannot allow double-claiming.

### 5. MarketVault
- **Responsibilities:** Custody of ERC20 collateral for a single View. Exposes exactly three state-changing methods: `deposit()`, `withdraw()`, `settle()`.
- **Forbidden:** Any arbitrary `transfer()` capability. Minting/burning Position Shares.
- **Invariants:** `actual ERC20 balance >= totalDeposits - totalWithdrawals - totalSettled`.

### 6. MarketVaultFactory
- **Responsibilities:** Deploys `MarketVault` instances. Enforces "One View = One Vault" via `VaultFactory__AlreadyDeployed`.
- **Forbidden:** Managing funds. Modifying rules.

### 7. PriceEngine
- **Responsibilities:** Pure calculation of Pulse Index and trade quotes (CSM algorithm).
- **Forbidden:** Any `storage` state. Transferring tokens. Modifying market status.
- **Invariants:** Must use `MathLibrary.mulDiv`. Must enforce `min(newForSupply, newAgainstSupply) <= newReserveBalance`.

### 8. TWAPLibrary
- **Responsibilities:** Time-driven TWAP recording.
- **Rules:** `SNAPSHOT_INTERVAL` = 60s. `SETTLEMENT_WINDOW` = 30 mins before `EndTime`. Max 30 snapshots. Trades do not trigger updates unless the interval has elapsed.

### 9. MathLibrary
- **Responsibilities:** Safe arithmetic, full-precision `mulDiv`, overflow protection.
- **Rules:** `computeIndex` must handle `uint256` overflow gracefully via scale-down.

### 10. Interfaces
- **Rules:** Must contain complete NatSpec, Custom Errors, and Events. No unified Event interface; events remain in their respective module interfaces.

---

## D. Economic Model

The Pulse Protocol V1 utilizes a **Continuous Scoring Market (CSM)**. It is a fully collateralized, zero-LP, two-sided prediction market.

### 1. Pulse Index
- **Definition:** The market's probability estimate for the "For" outcome.
- **Range:** `(0, 10000)` exclusive. Clamped to `[1, 9999]`. `5000` represents 50/50.
- **Formula:** `Index = (ForSupply * 10000) / (ForSupply + AgainstSupply)`

### 2. Share Pricing
Each share represents a claim on exactly 1 unit of collateral if its side wins.
- **For Share Price:** `Index / 10000`
- **Against Share Price:** `(10000 - Index) / 10000`

### 3. Trade Quotes
- **Buy (Shares Out):** `sharesOut = amountIn * 10000 / sidePrice`
- **Sell (Amount Out):** `amountOut = sharesIn * sidePrice / 10000`
- *Note:* All division must use `MathLibrary.mulDiv` to prevent precision loss.

### 4. Settlement & TWAP
- Settlement is strictly based on the **Time-Weighted Average Price (TWAP)** recorded over the final 30 minutes of the market.
- **Rule:** TWAP > 5000 (For Wins); TWAP < 5000 (Against Wins); TWAP == 5000 (Draw, proportional refund).

### 5. Economic Invariants (Proven via Fuzzing)
1. **Capital Conservation (Solvency):** `min(ForSupply, AgainstSupply) <= VaultReserve`. The Vault will never be undercollateralized.
2. **Maximum Liability:** The maximum payout the protocol must honor is exactly `min(ForSupply, AgainstSupply)`.
3. **No Round-Trip Arbitrage:** Due to price impact, a sequence of Buy → Sell → Buy → Sell will always result in a net loss for the trader. Risk-free arbitrage is mathematically impossible.
4. **Price Monotonicity:** Buying FOR strictly increases the FOR price; Selling FOR strictly decreases the FOR price.
5. **Symmetry:** At a 50/50 state, buying FOR and buying AGAINST produce perfectly mirrored index shifts.

### 6. Known Limitations
- **High Slippage on Low Liquidity:** As a zero-LP CSM, early trades experience high price impact.
- **Dust Retention:** Integer division flooring means selling microscopic fractions of a share may return 0 collateral.
- **Trapped Capital on Extreme Manipulation:** If an attacker buys a massive position pushing the index to 9999, they cannot immediately sell all shares back, as doing so would violate the solvency invariant. Their capital is effectively trapped until opposing liquidity enters.
