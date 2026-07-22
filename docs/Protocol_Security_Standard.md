# Pulse Protocol V1 — Protocol Security Standard

**Status:** Ratified after MarketVault Final Audit  
**Applies to:** All Core Contracts (PriceEngine, TradingEngine, FeeManager, SettlementManager, PulseFactory)

This document is the authoritative security specification for all Solidity development in Pulse Protocol V1. Every rule defined here is a **mandatory implementation constraint**, not a suggestion.

---

## Development Priority Order

All implementation decisions must be evaluated in the following order:

1. **Correctness** — The contract must behave exactly as specified by the protocol.
2. **Security** — The contract must be resistant to all known attack vectors.
3. **Auditability** — The contract must be readable and verifiable by a third-party auditor without access to internal documentation.
4. **Gas Optimization** — Gas savings are only acceptable if they do not compromise the above three priorities.

---

## 1. Minimum Privilege Principle

Every module is strictly limited to its defined responsibility. No module may acquire or exercise permissions beyond its boundary.

| Module | Permitted | Forbidden |
|---|---|---|
| **PriceEngine** | Price calculation, Pulse Index calculation, Quote generation | Vault operations, token transfers, Position modification, Market state changes |
| **TradingEngine** | Trade execution, Position accounting, Market state management | Bypassing PriceEngine to modify prices, directly modifying Settlement results |
| **SettlementManager** | Reading final TWAP, determining result, triggering payouts | Modifying historical market rules, modifying user Positions |
| **FeeManager** | Recording and distributing fees | Accessing Vault directly, modifying trade logic |
| **PulseFactory** | Creating Views, registering Vaults | Modifying existing View parameters after creation |

---

## 2. Accounting Safety Standard

All calculations involving `amount`, `balance`, `supply`, `reserve`, `payout`, or `fee` must satisfy:

```
Protocol Accounting <= Actual Asset Backing
```

It is **strictly forbidden** for any code path to produce a state where:

```
User Claim Value > Vault Assets
```

Every critical state change must follow the three-step pattern:

1. **Before Check** — Validate all inputs and preconditions before any state mutation.
2. **State Update** — Apply the state change (Effects before Interactions).
3. **After Invariant Check** — Verify the post-state satisfies the accounting invariant.

---

## 3. PriceEngine Core Boundary

PriceEngine is a **Pure Calculation Layer**. It must:

- Only perform price calculation, Pulse Index calculation, and quote generation.
- Use `pure` or `view` visibility for all functions.
- Hold **zero storage** (no supply, reserve, position, or vault state).

It is **forbidden** to add any of the following to PriceEngine:
- Storage of user balances or positions
- Storage of Vault state
- Token transfer logic
- Settlement logic

---

## 4. Pulse Index Security

The Pulse Index is defined as follows:

| Value | Meaning |
|---|---|
| `0` | 100% Against (never reachable; clamped to `1`) |
| `5000` | 50/50 (initial state) |
| `10000` | 100% For (never reachable; clamped to `9999`) |

**All outputs** from any function that computes or updates the Pulse Index **must pass through `validateIndex()`** or `clampIndex()`. No function path may produce an index of `0` or `>= 10000`.

---

## 5. Mathematical Security

All calculations involving price, supply, amount, ratio, fee, TWAP, or settlement **must use full-precision `mulDiv`**. Direct `a * b / c` expressions are **forbidden**.

Rationale: Direct multiplication followed by division can overflow in intermediate steps or lose precision, enabling economic manipulation attacks.

---

## 6. Economic Attack Resistance

### Flash Loan Manipulation
PriceEngine must not use spot price or single-block price as a settlement input. All settlement-critical values must be derived from the TWAP (time-weighted data recorded over the 30-minute settlement window).

### Extreme Price Movement
All implementations must be tested against:
- Maximum supply imbalance (e.g., `forSupply = type(uint256).max - 1`, `againstSupply = 1`)
- Maximum `uint256` input amounts
- Tiny liquidity scenarios (both supplies near zero)
- Huge single orders relative to existing supply

The following outcomes are **always forbidden**:
- Free shares (shares minted with zero cost)
- Negative reserve (reserve underflow)
- Over-collateralised payout (payout exceeds Vault balance)

---

## 7. State Isolation

Every View must have completely independent state. It is **forbidden** for any two Views to share `supply`, `reserve`, or `index` data.

All per-View data must be stored as:

```solidity
mapping(uint256 viewId => ViewState) internal _states;
```

---

## 8. Upgrade Safety

The economic rules of an existing View are **permanently immutable** after creation. This includes:

- Fee Rate
- Settlement Rule
- Collateral Token
- PriceEngine Version

At View creation time, an **Immutable Economic Snapshot** must be saved in the Factory Registry. New protocol versions may only affect Views created after the upgrade.

---

## 9. Testing Requirements

Every module must be tested across four categories before proceeding to the next stage:

| Category | Coverage |
|---|---|
| **Functional** | Normal buy/sell quote, index update, fee recording |
| **Boundary** | Zero amount, maximum amount, maximum supply, minimum supply |
| **Attack** | Flash loan simulation, invalid index generation, extreme imbalance, reentrancy |
| **Economic** | Verify `Maximum possible payout <= Vault Assets` under all conditions |

Development must **stop and await security review** after each module is completed.

---

## 10. Documentation Requirement

Every public or external function must include complete NatSpec:

```solidity
/// @notice One-sentence description of what the function does.
/// @dev    Implementation details, security notes, CEI order, math formula with economic meaning.
/// @param  paramName Description of the parameter.
/// @return returnName Description of the return value.
```

Every critical mathematical formula must document its **economic meaning** so that a third-party auditor can understand the design without reading the full codebase.
