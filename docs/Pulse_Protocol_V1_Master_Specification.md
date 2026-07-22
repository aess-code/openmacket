# Pulse Protocol V1 Master Specification
*(Updated after Stage 4.5 Protocol Hardening)*

## Single Source of Truth (SSOT)

This document is the **Single Source of Truth (SSOT)** for the entire Pulse Protocol V1. 

Any implementation, contract, interface, test, documentation, frontend behavior, backend service, API, SDK, audit report, simulation, or future proposal that conflicts with this Master Specification is considered incorrect and MUST be updated to match this document.

**Priority Order:**
1. Master Specification (SSOT)
2. Protocol Security Standards
3. Protocol Freeze Report
4. Solidity Implementations
5. Tests
6. Frontend / Backend / SDK
7. Documentation
8. Audit Reports

**Protocol Behavior Change Rule:** Any change to protocol behavior MUST first be proposed and merged into this Master Specification. Code implementations may only be modified after the Master Specification has been officially updated. The Master Specification itself MUST NOT be implicitly changed by implementation details.

## A. Architecture

Pulse Protocol V1 uses a **Shared Logic + Isolated Vault** architecture.

### Core Contracts
1. **PulseFactory:** The sole entry point for creating and registering Views. It atomically deploys Vaults and freezes the rule snapshot (PriceEngine, SettlementManager, FeeConfig) for the View.
2. **TradingEngine:** The shared business logic layer. It manages all Position accounting, TWAP snapshots, and market state transitions (`ACTIVE` → `LOCKED` → `SETTLEMENT` → `CLAIMABLE`).
3. **FeeManager:** A global, viewId-scoped ledger for fees. It uses a Pull-over-Push model where Creators, Treasury, and Team must actively claim their fees.
4. **SettlementManager:** Reads the finalised TWAP from the TradingEngine, determines the winning side, triggers the Vault payout, and allows permissionless reward claiming.

### Infrastructure Modules
- **MarketVault:** A per-View isolated contract that holds ERC20 collateral. It performs no business logic, holds no positions, and only exposes `deposit`, `withdraw`, and `settle` to authorized engines.
- **MarketVaultFactory:** Deploys MarketVaults deterministically.
- **PriceEngine:** A stateless, pure-calculation module that implements the Continuous Scoring Market (CSM) algorithm.

### Libraries
- **MathLibrary:** Provides true 512-bit intermediate precision `mulDiv` to prevent overflow, and handles Pulse Index calculations.
- **TWAPLibrary:** Manages time-driven Pulse Index snapshots and computes the final time-weighted average price.

---

## B. Design Principles

1. **One View = One Vault:** Collateral is strictly isolated. A hack in one View cannot drain another.
2. **Shared TradingEngine:** All Views share one TradingEngine to minimize deployment costs.
3. **Internal Position Accounting:** Position Shares are internal ledger entries in the TradingEngine, NOT ERC20/ERC1155 tokens. They cannot be transferred.
4. **Pull-over-Push Fee:** Fees are recorded internally. The protocol never initiates external transfers to fee recipients during trades, preventing DoS via blacklisted addresses.
5. **Atomic Creation:** If any step of View creation fails, the entire transaction reverts. No partial states.
6. **Immutable Rule Snapshot:** A View's FeeConfig, PriceEngine, and SettlementManager are frozen at creation. Upgrading the protocol does not alter historical Views.
7. **Least Privilege:** The Vault only accepts calls from the TradingEngine and SettlementManager. The PriceEngine cannot modify state.
8. **Checks-Effects-Interactions (CEI) & Reentrancy:** Strictly enforced across all state-changing functions.
9. **Invariant Driven Design:** The protocol guarantees Solvency, Capital Conservation, and No Free Shares mathematically.
10. **Capped Payout Solvency Model:** In a zero-LP CSM, `max(For, Against) > Reserve` is mathematically expected. The protocol enforces `min(For, Against) <= Reserve` and caps settlement payouts at the total Vault Reserve, distributing it proportionally to the winning side.

---

## C. Module Specification

### 1. PulseFactory
- **State:** `mapping(uint256 => ViewRecord) _registry`
- **ViewRecord:** Freezes `viewId`, `creator`, `startTime`, `endTime`, `vault`, `priceEngine`, `settlementManager`, and `feeConfig`.
- **Constraints:** `endTime >= startTime + 60 minutes` (30m trading + 30m settlement window).

### 2. TradingEngine (Stage 5 Target)
- **State:** 
  - `MarketState` (Status, forSupply, againstSupply, reserveBalance)
  - `TWAPState` (Snapshots, count, locked status)
  - `Positions` (viewId => user => side => shares)
- **Functions:** `buy`, `sell`, `lockMarket`.
- **Flow:** Pulls tokens from User → Calls Vault `deposit()` (accounting only) → Updates state.

### 3. MarketVault
- **State:** `totalDeposits`, `totalWithdrawals`, `totalSettled`.
- **Flow:** Receives tokens directly from User (via TradingEngine transfer), then updates `totalDeposits` when `deposit()` is called. Enforces `balance >= tracked_net_assets` to reject fee-on-transfer tokens.

### 4. PriceEngine
- **State:** None. Pure functions only.
- **Invariant:** Enforces `min(newForSupply, newAgainstSupply) <= newReserveBalance` to guarantee the Capped Payout model.

### 5. TWAPLibrary
- **Logic:** Records snapshots strictly every 60 seconds during the last 30 minutes.
- **Fallback:** If zero snapshots are recorded in the window, it falls back to the `lastIndexBeforeWindow`. It only defaults to 5000 (Draw) if the market had zero activity its entire lifetime.

### 6. SettlementManager
- **Logic:** Reads final TWAP. If `TWAP > 5000` → For wins. If `< 5000` → Against wins. If `== 5000` → Draw.
- **Claim:** `claimReward(viewId, user)` allows permissionless cranking by Keepers.

---

## D. Economic Model (Protocol-Level Freeze)

The Pulse Protocol V1 utilizes a Continuous Scoring Market (CSM), which is a fully collateralized, zero-LP, two-sided prediction market.

**Winning Shares represent a proportional claim on the final Vault Reserve, not a fixed claim on one collateral token.**

No component of Pulse Protocol may assume, imply, document, test, or implement any form of fixed redemption, guaranteed 1:1 payout, or fixed collateral value per share. 

This definition applies consistently and permanently to:
- Smart Contracts
- Interfaces
- NatSpec
- Tests
- Frontend
- Backend
- SDKs
- Documentation
- Audit Reports
- Future protocol upgrades

---

## E. Development Rules

1. **Math Operations:** Direct `*` and `/` are FORBIDDEN for financial calculations. You MUST use `MathLibrary.mulDiv`.
2. **State Modification:** The `PriceEngine` MUST NOT contain any storage variables.
3. **Vault Access:** `MarketVault` MUST NOT execute `transferFrom`. It only executes `safeTransfer` outwards on withdraw/settle.
4. **Upgrades:** You may deploy a new `PriceEngine` or `SettlementManager`, but you MUST NOT alter the `ViewRecord` of existing Views.

---

## F. Next Development Stage: Stage 5 (TradingEngine)

**Goal:** Implement `TradingEngine.sol` according to the architecture.

**Responsibilities:**
- Manage the 5-state Market lifecycle (`ACTIVE` → `LOCKED` → `SETTLEMENT` → `CLAIMABLE` → `CLOSED` removed, ends at `CLAIMABLE`).
- Manage user Position Share accounting.
- Execute `buy` and `sell` flows by coordinating `PriceEngine`, `FeeManager`, and `MarketVault`.
- Manage TWAP snapshot recording via `TWAPLibrary`.

**Implementation Order:**
1. State structures (`MarketState`, `Position` mapping).
2. Status transition modifiers (`onlyStatus`).
3. `buy` function (including Fee deduction, PriceEngine quote, User→Vault transfer, Vault deposit, TWAP tryRecord).
4. `sell` function.
5. `lockMarket` function (Permissionless, triggers `TWAPLibrary.finaliseTWAP`).

**Invariants to Maintain:**
- Vault `deposit()` is called ONLY AFTER tokens are transferred to the Vault.
- `buy` and `sell` MUST NOT be callable after `endTime`.
- `lockMarket` MUST be callable by anyone once `block.timestamp >= endTime`.
