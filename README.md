# Pulse Protocol V1

> **Current Development Stage: Stage 4.5 Completed — Stage 5 (TradingEngine) Not Yet Started**

Pulse Protocol V1 is an open-source, fully collateralized, zero-LP prediction market protocol built on EVM-compatible chains.

---

## Single Source of Truth (SSOT)

The **[Master Specification](./docs/Pulse_Protocol_V1_Master_Specification.md)** is the Single Source of Truth (SSOT) for this entire protocol.

Any implementation, contract, interface, test, documentation, frontend, or audit report that conflicts with the Master Specification is considered incorrect and must be updated to conform.

**Priority Order:**
1. Master Specification (SSOT)
2. Protocol Security Standards
3. Protocol Freeze Report
4. Solidity Implementations
5. Tests
6. Frontend / Backend / SDK
7. Documentation
8. Audit Reports

**Protocol Behavior Change Rule:** Any change to protocol behavior MUST first be merged into the Master Specification. Code may only be modified after the Master Specification is updated.

---

## Architecture Overview

Pulse Protocol V1 uses a **Shared Logic + Isolated Vault** architecture.

| Module | Type | Status |
|---|---|---|
| `PulseFactory` | Core Contract | Interface Complete |
| `TradingEngine` | Core Contract | **Stage 5 — Not Started** |
| `FeeManager` | Core Contract | Interface Complete |
| `SettlementManager` | Core Contract | Interface Complete |
| `MarketVault` | Infrastructure | Stage 3 Complete |
| `MarketVaultFactory` | Infrastructure | Stage 3 Complete |
| `PriceEngine` | Infrastructure | Stage 4 Complete |
| `MathLibrary` | Library | Stage 2 Complete |
| `TWAPLibrary` | Library | Stage 2 Complete |

---

## Economic Model

Pulse Protocol V1 uses the **Proportional Pool Distribution** (Capped Payout CSM) model.

> **Winning Shares represent a proportional claim on the final Vault Reserve, not a fixed claim on one collateral token.**

Settlement formula:
```
PayoutPerShare = VaultReserve / WinningShares
UserReward     = UserWinningShares x PayoutPerShare
```

No component of this protocol may implement, imply, or document any form of fixed redemption, guaranteed 1:1 payout, or fixed collateral value per share.

---

## Development Progress

| Stage | Module | Status | Tests |
|---|---|---|---|
| Stage 1 | Interfaces (7 files) | Complete | — |
| Stage 2 | Libraries (MathLibrary, TWAPLibrary) | Complete | — |
| Stage 3 | MarketVault + MarketVaultFactory | Complete | 43 tests pass |
| Stage 3 Hardening | Security Hardening + Invariant Fuzz | Complete | 35 tests pass |
| Stage 4 | PriceEngine (CSM) | Complete | 35 tests pass |
| Stage 4.5 | Protocol Hardening (10 fixes) | Complete | 26 tests pass |
| **Stage 5** | **TradingEngine** | **Not Started** | — |
| Stage 6 | FeeManager | Not Started | — |
| Stage 7 | SettlementManager | Not Started | — |
| Stage 8 | PulseFactory | Not Started | — |

---

## Repository Structure

```
/contracts
  /interfaces       — 7 Protocol Interfaces (IPulseFactory, ITradingEngine, ...)
  /libraries        — MathLibrary, TWAPLibrary
  /pricing          — PriceEngine (Continuous Scoring Market)
  /vault            — MarketVault, MarketVaultFactory
  /test             — Mock contracts for testing

/test               — Hardhat test suites (6 files, 139+ test cases)
/scripts            — Economic validation scripts (Python)
/docs               — Protocol specifications and design documents
/audits             — Audit reports and security analyses
```

---

## Key Documents

| Document | Location | Purpose |
|---|---|---|
| Master Specification (SSOT) | `docs/Pulse_Protocol_V1_Master_Specification.md` | Highest-priority protocol reference |
| Protocol Freeze Report | `docs/Protocol_Freeze_Report.md` | Frozen protocol definitions |
| Protocol Security Standard | `docs/Protocol_Security_Standard.md` | Security requirements for all modules |
| Protocol Hardening Report | `docs/Protocol_Hardening_Report.md` | Stage 4.5 fix summary |
| CSM Solvency Derivation | `docs/CSM_Solvency_Derivation.md` | Mathematical proof of solvency model |
| Cross Module Audit | `audits/Cross_Module_Audit_Report.md` | Independent security audit |
| Vault Security Report | `audits/Final_Vault_Security_Report.md` | MarketVault security analysis |
| PriceEngine Economic Report | `audits/PriceEngine_Economic_Security_Report.md` | Economic model validation |

---

## Development Rules

- All math operations MUST use `MathLibrary.mulDiv` — direct multiplication and division are forbidden for financial calculations.
- `PriceEngine` MUST NOT contain any storage variables.
- `MarketVault` MUST NOT execute `transferFrom` — it only executes `safeTransfer` outwards.
- Upgrades may only replace `PriceEngine` or `SettlementManager` — `ViewRecord` of existing Views is immutable.
- ReentrancyGuard, CEI pattern, Custom Errors, and NatSpec are mandatory in all contracts.

---

## Engineering Principles

The original engineering principles document is preserved at [`docs/README_Engineering_Principles.md`](./docs/README_Engineering_Principles.md).

---

## License

MIT
