## E. Security Specification

All development MUST adhere to the ratified `Protocol_Security_Standard.md`.

### 1. Mandatory Security Rules
- **No ERC20 Pollution:** Position Shares are internal accounting only. No `transfer()`, `approve()`, or `allowance()` functions exist for positions.
- **Strict Invariant Checks:** The pattern `Before Check` → `State Update` → `After Invariant Check` is mandatory for all critical state changes.
- **Vault Protection:** The `_assertInvariant()` function uses `>=` (`actualBalance >= trackedNetAssets`) to prevent DoS via token donations (Griefing Attack).
- **Unsupported Tokens:** Fee-on-transfer and rebasing tokens are explicitly unsupported. The Vault's invariant check will immediately revert any transaction involving them, safely halting the market.
- **Index Clamping:** All Pulse Index calculations MUST pass through `clampIndex()` to ensure the index never hits `0` or `10000`, preventing division-by-zero errors.

### 2. Attack Simulation Coverage
The protocol has been proven resilient against:
- **Flash Loan Manipulation:** Defeated by TWAP settlement and the zero-LP capital requirement.
- **Reentrancy:** Defeated by CEI pattern and OpenZeppelin `ReentrancyGuard`.
- **Accounting Drift:** Defeated by strict Vault invariant checks comparing actual `balanceOf` against internal counters.
- **Extreme Imbalance / MaxUint256:** Defeated by `MathLibrary` scale-down logic and the `minSupply <= reserve` solvency check.

---

## F. Development Progress

The protocol development is structured in stages. The following stages are **COMPLETED, TESTED, and AUDITED**:

### Stage 1: Interfaces
- **Completed:** `IPulseFactory`, `ITradingEngine`, `IFeeManager`, `ISettlementManager`, `IMarketVault`, `IMarketVaultFactory`, `IPriceEngine`.
- **Details:** Full NatSpec, Custom Errors, and Events defined. Position accounting confirmed as internal. FeeManager confirmed as Pull-over-Push.
- **Git Commit:** `e1fcc0e`

### Stage 2: Libraries
- **Completed:** `MathLibrary.sol`, `TWAPLibrary.sol`.
- **Details:** Full-precision `mulDiv` implemented. Time-driven TWAP logic established (60s interval, 30m window).
- **Git Commit:** `8b7b918`

### Stage 3: MarketVault & MarketVaultFactory
- **Completed:** `MarketVault.sol`, `MarketVaultFactory.sol`.
- **Details:** 43 unit tests passed. 6 attack scenarios simulated (MockAttackTokens). 10,000+ invariant fuzz operations passed.
- **Audit Result:** Final Vault Security Report confirmed production DeFi readiness. No Critical/High risks.
- **Git Commit:** `2d973fe`

### Stage 4: PriceEngine
- **Completed:** `PriceEngine.sol`.
- **Details:** Stateless CSM algorithm implemented. 35 unit tests passed (Functional, Boundary, Attack, Economic). 10,000+ economic invariant fuzz operations passed.
- **Audit Result:** PriceEngine Economic Security Report confirmed no arbitrage, strict solvency, and correct pricing dynamics.
- **Git Commit:** `052c4ab`

---

## G. Development Rules

Future development must strictly observe the following boundaries:

### 1. Immutable Protocol Rules (Never Change)
- Position Shares are internal and non-transferable.
- One View = One Isolated Vault.
- Pull-over-Push Fee Model.
- Mathematical requirement to use `mulDiv`.

### 2. Frozen Historical Rules (View Snapshot)
When a View is created, the following are permanently frozen for that specific View:
- Fee Rate (Creator, Treasury, Team).
- Settlement Rule (End Time).
- Collateral Token.
- PriceEngine Version.

### 3. Upgradable Modules (For Future Views Only)
- `PriceEngine`
- `FeeManager`
- `SettlementManager`

### 4. Non-Upgradable Modules
- `PulseFactory` (The Registry).
- Existing `MarketVault` instances.

---

## H. Next Development Stage

### Stage 5: TradingEngine

**The next development session MUST begin exactly here.**

- **Development Goal:** Implement `TradingEngine.sol` as the central shared execution layer.
- **Primary Responsibilities:**
  - Execute `buy()` and `sell()` operations.
  - Maintain the Market Status Machine (`ACTIVE` → `LOCKED` → `SETTLEMENT` → `CLAIMABLE`).
  - Maintain per-View internal Position Accounting.
  - Coordinate calls to `PriceEngine`, `FeeManager`, `MarketVault`, and `TWAPLibrary`.
- **Inputs/Outputs:**
  - Receives trade requests from users.
  - Passes state to `PriceEngine` to receive quotes.
  - Commands `MarketVault` to pull/push collateral.
- **Interfaces to Implement:** `ITradingEngine`.
- **Dependencies:** `IPriceEngine`, `IFeeManager`, `IMarketVault`, `IPulseFactory`, `TWAPLibrary`.
- **Implementation Sequence:**
  1. State variables and constructor.
  2. Status management (`lockMarket`, `setStatusClaimable`).
  3. Internal TWAP recording hook.
  4. Trade execution (`buy`, `sell`).
  5. View functions.
- **Key Risks & Invariants to Maintain:**
  - Trades MUST NOT execute if status != `ACTIVE`.
  - `lockMarket` MUST strictly enforce `block.timestamp >= endTime`.
  - `buy` and `sell` MUST accurately reflect the exact shares/collateral returned by `PriceEngine`.
  - `buy` MUST enforce a minimum trade size to prevent dust attacks.
  - `sell` MUST handle the dust limitation identified in the PriceEngine Economic Report.
- **Testing Requirements:**
  - Full state machine transition testing.
  - TWAP snapshot timing verification.
  - Integration testing with Mock PriceEngine, Mock Vault, and Mock FeeManager.
- **Forbidden Actions (Do NOT Implement):**
  - Do NOT implement settlement outcome logic (that belongs to SettlementManager).
  - Do NOT implement fee claiming (that belongs to FeeManager).
  - Do NOT store ERC20 tokens in TradingEngine.

---
**END OF SPECIFICATION**
