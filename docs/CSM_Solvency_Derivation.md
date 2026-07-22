# CSM Solvency Invariant — Complete Mathematical Derivation

**Version:** 2.0 (Post Stage 4.5 Hardening + Protocol Freeze)  
**Status:** Ratified. This document supersedes all previous solvency analyses.

---

## 1. Model Definition

A Continuous Scoring Market (CSM) with two sides: **For** (side 0) and **Against** (side 1).

- `F` = total For Position Shares outstanding
- `A` = total Against Position Shares outstanding
- `R` = Vault Reserve (total net collateral held: deposits - withdrawals)
- `I` = Pulse Index = `mulDiv(F, 10000, F + A)`, range (0, 10000)
- `P_F` = For share price = `I / 10000`
- `P_A` = Against share price = `(10000 - I) / 10000`

---

## 2. Share Definition (Protocol Freeze)

> **A Position Share is a PROPORTIONAL CLAIM on the final Vault Reserve, contingent on the holder's side winning at settlement.**

A Position Share does NOT represent a fixed claim of 1 collateral token. The protocol makes no promise of "1 Share = 1 USDT". The settlement formula is:

```
PayoutPerShare = VaultReserve / WinningShares
UserReward     = UserWinningShares × PayoutPerShare
```

This is the **Proportional Pool Distribution** model.

---

## 3. Why max(F, A) ≤ R Cannot Be Maintained in a Zero-LP CSM

**Proof by example:**

At `I = 5000`, buying 100 USDT issues `100 × 10000 / 5000 = 200` shares.

After the trade: `F = 200`, `R = 100`. Therefore `max(200, 0) = 200 > 100`.

The invariant `max(F, A) ≤ R` is violated from the very first trade. This is not a bug — it is a mathematical consequence of shares being priced below 1.0.

**Conclusion:** `max(F, A) ≤ R` is impossible to maintain in a zero-LP CSM without initial liquidity. It is not the correct invariant for this model.

---

## 4. The Correct Invariant: min(F, A) ≤ R

The correct solvency invariant for the Proportional Pool Distribution model is:

```
min(ForSupply, AgainstSupply) ≤ VaultReserve
```

**Why this is sufficient:**

Under the Proportional Pool Distribution model, the winning side receives `R / WinningShares` per share, not 1.0. The Vault's obligation is always exactly `R` (its entire balance), distributed proportionally. It never owes more than it holds.

The `min(F, A) ≤ R` invariant ensures:
1. The Vault always has enough to pay the smaller side in full (if they win).
2. The larger side receives a proportional payout from the remaining reserve.
3. The reserve never goes negative after any valid sell.

---

## 5. Settlement Calculation Under Proportional Pool Distribution

**If For wins (TWAP > 5000):**
```
PayoutPerShare_For = R / F
UserReward = UserForShares × (R / F)
```

**If Against wins (TWAP < 5000):**
```
PayoutPerShare_Against = R / A
UserReward = UserAgainstShares × (R / A)
```

**If Draw (TWAP == 5000):**
```
UserReward_For     = UserForShares × (R × F / (F + A)) / F = UserForShares × R / (F + A)
UserReward_Against = UserAgainstShares × R / (F + A)
```
*(Each side receives a proportional share of R based on their fraction of total supply.)*

**In all cases: Total Payout = R (the Vault is fully distributed, never overpays, never underpays).**

---

## 6. Economic Guarantee for Winners

**Claim:** Under the Proportional Pool Distribution model, winning shareholders always receive more than their average buy price.

**Proof:**

Let `C_F` = total collateral deposited by For buyers (net of sells) = `Σ(amountIn_i)`.

By the CSM pricing model, each For buyer paid `P_F_i = I_i / 10000 < 1.0` per share. Therefore:
```
C_F = Σ(sharesOut_i × P_F_i) < Σ(sharesOut_i) = F
```

This means `C_F < F` (total For deposits are less than total For shares).

At settlement, the For payout is `R / F` per share. Since `R ≥ C_F` (the Vault holds all deposits from both sides, not just For), and `C_F < F`:
```
R / F ≥ C_F / F = avg_buy_price_For
```

**Therefore, the payout per share is always ≥ the average buy price. Winners are always profitable in expectation.**

---

## 7. Summary of Invariants

| Invariant | Formula | Status |
|---|---|---|
| Proportional Solvency | `min(F, A) ≤ R` | Enforced by PriceEngine |
| Capital Conservation | `R ≥ 0` after any sell | Enforced by PriceEngine |
| Winner Profitability | `PayoutPerShare ≥ avg_buy_price` | Proven above |
| No Overpayment | `Total Payout = R` (exactly) | By definition of Proportional Pool |
