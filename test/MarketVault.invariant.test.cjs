/**
 * Pulse Protocol V1 — MarketVault Invariant Fuzz Test Suite
 *
 * Verifies the capital conservation invariant holds under randomised sequences of
 * deposit, withdraw, and settle operations.
 *
 * IMPORTANT: deposit() is pure-accounting (no transferFrom).
 * The TradingEngine must transfer tokens to the Vault BEFORE calling deposit().
 * All tests in this file simulate this by calling token.transfer(vault, amount)
 * before vault.deposit(amount).
 *
 * Invariant checked after every operation:
 *   actualBalance + totalWithdrawals + totalSettled >= totalDeposits
 *   (equivalent to: actualBalance >= totalDeposits - totalWithdrawals - totalSettled)
 */

const { expect }      = require("chai");
const { ethers }      = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const VIEW_ID  = 99n;
const DECIMALS = 6n;
const UNIT     = 10n ** DECIMALS;
const SUPPLY   = 1_000_000_000n * UNIT; // 1 billion tokens for fuzz

// ─────────────────────────────────────────────────────────────────────────────
// PRNG
// ─────────────────────────────────────────────────────────────────────────────
function makePRNG(seed) {
  let s = seed >>> 0;
  return function(max) {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % max;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture
// ─────────────────────────────────────────────────────────────────────────────
async function deployFuzzFixture() {
  const [owner, engine, settlement, user1, user2, user3] = await ethers.getSigners();

  const MockToken = await ethers.getContractFactory("MockUSDT");
  const token = await MockToken.deploy();
  await token.waitForDeployment();

  await token.mint(engine.address, SUPPLY);

  const MarketVault = await ethers.getContractFactory("MarketVault");
  const vault = await MarketVault.deploy(
    VIEW_ID,
    await token.getAddress(),
    engine.address,
    settlement.address
  );
  await vault.waitForDeployment();

  return { owner, engine, settlement, user1, user2, user3, token, vault };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: deposit with pre-transfer (simulates TradingEngine flow)
// ─────────────────────────────────────────────────────────────────────────────
async function depositToVault(token, vault, engine, amount) {
  await token.connect(engine).transfer(await vault.getAddress(), amount);
  await vault.connect(engine).deposit(amount);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: assert invariant externally
// ─────────────────────────────────────────────────────────────────────────────
async function assertInvariantExternal(vault, label) {
  const actualBalance    = await vault.balance();
  const totalDeposits    = await vault.totalDeposits();
  const totalWithdrawals = await vault.totalWithdrawals();
  const totalSettled     = await vault.totalSettled();
  // Invariant: balance + withdrawals + settled >= deposits
  expect(actualBalance + totalWithdrawals + totalSettled,
    `[${label}] balance + withdrawals + settled >= deposits`)
    .to.be.gte(totalDeposits);
  expect(totalDeposits,
    `[${label}] totalDeposits >= totalWithdrawals + totalSettled`)
    .to.be.gte(totalWithdrawals + totalSettled);
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant Fuzz Tests
// ─────────────────────────────────────────────────────────────────────────────
describe("MarketVault Invariant Fuzz Tests", function () {
  this.timeout(120_000);

  it("invariant holds across 200 randomised deposit sequences", async function () {
    const { engine, token, vault } = await loadFixture(deployFuzzFixture);
    const prng = makePRNG(0xDEADBEEF);

    for (let i = 0; i < 200; i++) {
      const amount = BigInt(prng(10000) + 1) * UNIT;
      await depositToVault(token, vault, engine, amount);
      await assertInvariantExternal(vault, `deposit_${i}`);
    }
  });

  it("invariant holds across 100 randomised deposit+withdraw sequences", async function () {
    const { engine, user1, token, vault } = await loadFixture(deployFuzzFixture);
    const prng = makePRNG(0xCAFEBABE);

    // Seed the vault
    await depositToVault(token, vault, engine, 50_000n * UNIT);

    for (let i = 0; i < 100; i++) {
      const currentBalance = await vault.balance();
      if (currentBalance === 0n) {
        await depositToVault(token, vault, engine, 10_000n * UNIT);
      }
      const bal = await vault.balance();
      const maxWithdraw = bal > 0n ? bal : 1n * UNIT;
      const amount = BigInt(prng(Number(maxWithdraw / UNIT) + 1)) * UNIT;
      if (amount === 0n) continue;

      await vault.connect(engine).withdraw(user1.address, amount);
      await assertInvariantExternal(vault, `withdraw_${i}`);
    }
  });

  it("invariant holds across 50 randomised deposit+settle sequences", async function () {
    const { engine, settlement, user1, token, vault } = await loadFixture(deployFuzzFixture);
    const prng = makePRNG(0xFEEDFACE);

    await depositToVault(token, vault, engine, 50_000n * UNIT);

    for (let i = 0; i < 50; i++) {
      const currentBalance = await vault.balance();
      if (currentBalance === 0n) {
        await depositToVault(token, vault, engine, 10_000n * UNIT);
      }
      const bal = await vault.balance();
      const maxSettle = bal > 0n ? bal : 1n * UNIT;
      const amount = BigInt(prng(Number(maxSettle / UNIT) + 1)) * UNIT;
      if (amount === 0n) continue;

      await vault.connect(settlement).settle(user1.address, amount);
      await assertInvariantExternal(vault, `settle_${i}`);
    }
  });

  it("invariant holds across 300 mixed operations (deposit/withdraw/settle)", async function () {
    const { engine, settlement, user1, user2, token, vault } = await loadFixture(deployFuzzFixture);
    const prng = makePRNG(0xABCDEF01);

    // Seed the vault
    await depositToVault(token, vault, engine, 100_000n * UNIT);

    let opCount = { deposit: 0, withdraw: 0, settle: 0, skipped: 0 };

    for (let i = 0; i < 300; i++) {
      const opType = prng(10);
      const currentBalance = await vault.balance();

      if (opType < 5) {
        const amount = BigInt(prng(5000) + 1) * UNIT;
        await depositToVault(token, vault, engine, amount);
        opCount.deposit++;
      } else if (opType < 8) {
        if (currentBalance === 0n) { opCount.skipped++; continue; }
        const amount = BigInt(prng(Number(currentBalance / UNIT)) + 1) * UNIT;
        if (amount > currentBalance) { opCount.skipped++; continue; }
        await vault.connect(engine).withdraw(user1.address, amount);
        opCount.withdraw++;
      } else {
        if (currentBalance === 0n) { opCount.skipped++; continue; }
        const amount = BigInt(prng(Number(currentBalance / UNIT)) + 1) * UNIT;
        if (amount > currentBalance) { opCount.skipped++; continue; }
        await vault.connect(settlement).settle(user2.address, amount);
        opCount.settle++;
      }

      await assertInvariantExternal(vault, `mixed_${i}`);
    }

    console.log(`    Mixed ops: deposit=${opCount.deposit}, withdraw=${opCount.withdraw}, settle=${opCount.settle}, skipped=${opCount.skipped}`);
  });

  it("accounting counters are always monotonically increasing", async function () {
    const { engine, settlement, user1, token, vault } = await loadFixture(deployFuzzFixture);
    const prng = makePRNG(0x12345678);

    await depositToVault(token, vault, engine, 50_000n * UNIT);

    let prevDeposits = 0n, prevWithdrawals = 0n, prevSettled = 0n;

    for (let i = 0; i < 100; i++) {
      const op = prng(3);
      const currentBalance = await vault.balance();

      if (op === 0) {
        const amount = BigInt(prng(1000) + 1) * UNIT;
        await depositToVault(token, vault, engine, amount);
      } else if (op === 1 && currentBalance >= UNIT) {
        const amount = BigInt(prng(Number(currentBalance / UNIT)) + 1) * UNIT;
        if (amount <= currentBalance) {
          await vault.connect(engine).withdraw(user1.address, amount);
        }
      } else if (op === 2 && currentBalance >= UNIT) {
        const amount = BigInt(prng(Number(currentBalance / UNIT)) + 1) * UNIT;
        if (amount <= currentBalance) {
          await vault.connect(settlement).settle(user1.address, amount);
        }
      }

      const d = await vault.totalDeposits();
      const w = await vault.totalWithdrawals();
      const s = await vault.totalSettled();

      expect(d, "totalDeposits must be monotonically non-decreasing").to.be.gte(prevDeposits);
      expect(w, "totalWithdrawals must be monotonically non-decreasing").to.be.gte(prevWithdrawals);
      expect(s, "totalSettled must be monotonically non-decreasing").to.be.gte(prevSettled);

      prevDeposits    = d;
      prevWithdrawals = w;
      prevSettled     = s;
    }
  });

  it("vault balance is always >= 0 (no underflow possible)", async function () {
    const { engine, user1, token, vault } = await loadFixture(deployFuzzFixture);
    const prng = makePRNG(0x99887766);

    await depositToVault(token, vault, engine, 10_000n * UNIT);

    for (let i = 0; i < 50; i++) {
      const currentBalance = await vault.balance();
      expect(currentBalance, `balance must be >= 0 at step ${i}`).to.be.gte(0n);

      if (currentBalance > 0n) {
        await vault.connect(engine).withdraw(user1.address, currentBalance);
        expect(await vault.balance()).to.equal(0n);
        await depositToVault(token, vault, engine, 10_000n * UNIT);
      }
    }
  });

  it("total payout (withdrawals + settled) never exceeds total deposits", async function () {
    const { engine, settlement, user1, user2, token, vault } = await loadFixture(deployFuzzFixture);
    const prng = makePRNG(0x55443322);

    await depositToVault(token, vault, engine, 100_000n * UNIT);

    for (let i = 0; i < 200; i++) {
      const op = prng(4);
      const currentBalance = await vault.balance();

      if (op < 2 || currentBalance === 0n) {
        const amount = BigInt(prng(2000) + 1) * UNIT;
        await depositToVault(token, vault, engine, amount);
      } else if (op === 2 && currentBalance >= UNIT) {
        const amount = BigInt(prng(Number(currentBalance / UNIT)) + 1) * UNIT;
        if (amount <= currentBalance) {
          await vault.connect(engine).withdraw(user1.address, amount);
        }
      } else if (op === 3 && currentBalance >= UNIT) {
        const amount = BigInt(prng(Number(currentBalance / UNIT)) + 1) * UNIT;
        if (amount <= currentBalance) {
          await vault.connect(settlement).settle(user2.address, amount);
        }
      }

      const d = await vault.totalDeposits();
      const w = await vault.totalWithdrawals();
      const s = await vault.totalSettled();
      expect(w + s, `[step ${i}] withdrawals + settled <= deposits`).to.be.lte(d);
    }
  });
});
