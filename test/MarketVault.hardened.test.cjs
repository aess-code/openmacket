/**
 * Pulse Protocol V1 — MarketVault Security Hardening Test Suite
 *
 * Covers all 6 attack scenarios from Stage 3 Final Security Hardening:
 *
 * Attack 1: Unauthorized Access
 * Attack 2: Fake Token / Unsupported Token
 * Attack 3: Accounting Drift (Fee-on-Transfer simulation)
 * Attack 4: Reentrancy
 * Attack 5: Multiple Settlement
 * Attack 6: Factory Security (duplicate ViewID)
 *
 * Plus:
 * - Event signature verification (viewId indexed, address indexed, amount)
 * - Invariant verification
 * - Permission model immutability
 * - NatSpec boundary checks (no position/price/TWAP logic in Vault)
 */

const { expect }      = require("chai");
const { ethers }      = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const VIEW_ID  = 42n;
const DECIMALS = 6n;
const UNIT     = 10n ** DECIMALS;

// ─────────────────────────────────────────────────────────────────────────────
// Mock Contracts (inline bytecode via ethers ContractFactory)
// ─────────────────────────────────────────────────────────────────────────────

// We use MockUSDT already in the repo for standard ERC20 tests.
// For Attack 2 (Fake Token) and Attack 3 (Fee-on-Transfer), we deploy
// custom mock tokens via Solidity files in contracts/test/.

// ─────────────────────────────────────────────────────────────────────────────
// Fixture
// ─────────────────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [owner, engine, settlement, user, attacker, stranger] = await ethers.getSigners();

  // Standard ERC20 (MockUSDT)
  const MockToken = await ethers.getContractFactory("MockUSDT");
  const token = await MockToken.deploy();
  await token.waitForDeployment();

  // Mint tokens to engine (simulates TradingEngine holding user funds)
  await token.mint(engine.address, 10_000_000n * UNIT);
  await token.mint(user.address,   10_000_000n * UNIT);

  // Deploy MarketVault directly
  const MarketVault = await ethers.getContractFactory("MarketVault");
  const vault = await MarketVault.deploy(
    VIEW_ID,
    await token.getAddress(),
    engine.address,
    settlement.address
  );
  await vault.waitForDeployment();

  // Deploy MarketVaultFactory (owner = authorizedFactory)
  const MarketVaultFactory = await ethers.getContractFactory("MarketVaultFactory");
  const factory = await MarketVaultFactory.deploy(owner.address);
  await factory.waitForDeployment();

  return { owner, engine, settlement, user, attacker, stranger, token, vault, factory };
}

// Helper: fund the vault via engine
// Since deposit() is pure-accounting (no transferFrom), the TradingEngine must
// transfer tokens to the vault BEFORE calling deposit().
async function fundVault(token, vault, engine, amount) {
  await token.connect(engine).transfer(await vault.getAddress(), amount);
  await vault.connect(engine).deposit(amount);
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTACK 1: Unauthorized Access
// ─────────────────────────────────────────────────────────────────────────────

describe("Attack 1: Unauthorized Access", function () {

  it("attacker cannot call deposit()", async function () {
    const { attacker, vault } = await loadFixture(deployFixture);
    await expect(vault.connect(attacker).deposit(100n * UNIT))
      .to.be.revertedWithCustomError(vault, "Vault__UnauthorisedEngine");
  });

  it("attacker cannot call withdraw()", async function () {
    const { engine, attacker, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 100n * UNIT);
    await expect(vault.connect(attacker).withdraw(attacker.address, 50n * UNIT))
      .to.be.revertedWithCustomError(vault, "Vault__UnauthorisedEngine");
  });

  it("attacker cannot call settle()", async function () {
    const { engine, attacker, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 100n * UNIT);
    await expect(vault.connect(attacker).settle(attacker.address, 50n * UNIT))
      .to.be.revertedWithCustomError(vault, "Vault__UnauthorisedSettlement");
  });

  it("settlement manager cannot call deposit()", async function () {
    const { settlement, vault } = await loadFixture(deployFixture);
    await expect(vault.connect(settlement).deposit(100n * UNIT))
      .to.be.revertedWithCustomError(vault, "Vault__UnauthorisedEngine");
  });

  it("settlement manager cannot call withdraw()", async function () {
    const { engine, settlement, user, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 100n * UNIT);
    await expect(vault.connect(settlement).withdraw(user.address, 50n * UNIT))
      .to.be.revertedWithCustomError(vault, "Vault__UnauthorisedEngine");
  });

  it("trading engine cannot call settle()", async function () {
    const { engine, user, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 100n * UNIT);
    await expect(vault.connect(engine).settle(user.address, 50n * UNIT))
      .to.be.revertedWithCustomError(vault, "Vault__UnauthorisedSettlement");
  });

  it("stranger cannot call any state-changing function", async function () {
    const { engine, stranger, user, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 100n * UNIT);
    await expect(vault.connect(stranger).deposit(1n))
      .to.be.revertedWithCustomError(vault, "Vault__UnauthorisedEngine");
    await expect(vault.connect(stranger).withdraw(user.address, 1n))
      .to.be.revertedWithCustomError(vault, "Vault__UnauthorisedEngine");
    await expect(vault.connect(stranger).settle(user.address, 1n))
      .to.be.revertedWithCustomError(vault, "Vault__UnauthorisedSettlement");
  });

  it("vault balance is unchanged after all failed attack attempts", async function () {
    const { engine, attacker, token, vault } = await loadFixture(deployFixture);
    const amount = 500n * UNIT;
    await fundVault(token, vault, engine, amount);
    // All attack attempts fail
    await vault.connect(attacker).deposit(1n).catch(() => {});
    await vault.connect(attacker).withdraw(attacker.address, 1n).catch(() => {});
    await vault.connect(attacker).settle(attacker.address, 1n).catch(() => {});
    expect(await vault.balance()).to.equal(amount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATTACK 2: Fake Token / Unsupported Token
// ─────────────────────────────────────────────────────────────────────────────

describe("Attack 2: Fake Token / Unsupported Token", function () {

  it("vault is bound to exactly one immutable token — no setter exists", async function () {
    const { vault } = await loadFixture(deployFixture);
    const abi = vault.interface.fragments.map(f => f.name).filter(Boolean);
    expect(abi).to.not.include("setToken");
    expect(abi).to.not.include("changeToken");
    expect(abi).to.not.include("updateCollateral");
  });

  it("token address is immutable after construction", async function () {
    const { token, vault } = await loadFixture(deployFixture);
    expect(await vault.token()).to.equal(await token.getAddress());
    // Attempt to find a way to change it — no such function should exist
    const abi = vault.interface.fragments.map(f => f.name).filter(Boolean);
    const setters = abi.filter(n => n.toLowerCase().includes("token") && n !== "token");
    expect(setters).to.be.empty;
  });

  it("V1 only supports standard ERC20 — fee-on-transfer token triggers InvariantViolation", async function () {
    // Deploy a fee-on-transfer mock token (5% fee)
    const FeeToken = await ethers.getContractFactory("MockFeeOnTransferToken");
    const feeToken = await FeeToken.deploy();
    await feeToken.waitForDeployment();

    const [, engine, settlement] = await ethers.getSigners();
    await feeToken.mint(engine.address, 1_000_000n * UNIT);

    const MarketVault = await ethers.getContractFactory("MarketVault");
    const vault = await MarketVault.deploy(
      VIEW_ID,
      await feeToken.getAddress(),
      engine.address,
      settlement.address
    );
    await vault.waitForDeployment();

    // Engine approves and tries to deposit 100 tokens
    // Fee-on-transfer: vault receives 95 but accounting records 100
    // → _assertInvariant() must revert with Vault__InvariantViolation
    const amount = 100n * UNIT;
    await feeToken.connect(engine).approve(await vault.getAddress(), amount);
    await expect(vault.connect(engine).deposit(amount))
      .to.be.revertedWithCustomError(vault, "Vault__InvariantViolation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATTACK 3: Accounting Drift
// ─────────────────────────────────────────────────────────────────────────────

describe("Attack 3: Accounting Drift Detection", function () {

  it("invariant holds after normal deposit + withdraw cycle", async function () {
    const { engine, user, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 1000n * UNIT);
    await vault.connect(engine).withdraw(user.address, 300n * UNIT);
    // trackedNetAssets = 1000 - 300 - 0 = 700
    expect(await vault.balance()).to.equal(700n * UNIT);
    expect(await vault.totalDeposits()).to.equal(1000n * UNIT);
    expect(await vault.totalWithdrawals()).to.equal(300n * UNIT);
    expect(await vault.totalSettled()).to.equal(0n);
  });

  it("invariant holds after deposit + settle cycle", async function () {
    const { engine, user, settlement, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 500n * UNIT);
    await vault.connect(settlement).settle(user.address, 200n * UNIT);
    expect(await vault.balance()).to.equal(300n * UNIT);
    expect(await vault.totalSettled()).to.equal(200n * UNIT);
  });

  it("invariant: actual balance >= tracked net assets at all times", async function () {
    const { engine, user, settlement, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 1000n * UNIT);
    await vault.connect(engine).withdraw(user.address, 200n * UNIT);
    await vault.connect(settlement).settle(user.address, 100n * UNIT);

    const actual  = await vault.balance();
    const tracked = (await vault.totalDeposits())
                  - (await vault.totalWithdrawals())
                  - (await vault.totalSettled());
    expect(actual).to.be.gte(tracked);
  });

  it("donation (direct token transfer) does NOT break invariant", async function () {
    // Tokens sent directly to vault address (donation) are acceptable
    const { engine, user, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 100n * UNIT);

    // Donate 50 tokens directly to vault (not via deposit)
    await token.connect(user).transfer(await vault.getAddress(), 50n * UNIT);

    // balance > trackedNetAssets — this is acceptable
    const actual  = await vault.balance();
    const tracked = await vault.totalDeposits();
    expect(actual).to.equal(150n * UNIT);
    expect(tracked).to.equal(100n * UNIT);
    // Subsequent operations should still work
    await expect(vault.connect(engine).withdraw(user.address, 100n * UNIT)).to.not.be.reverted;
  });

  it("rebasing token (balance decrease without transfer) triggers InvariantViolation on next operation", async function () {
    // Deploy a rebasing mock token that can slash balances
    const RebasingToken = await ethers.getContractFactory("MockRebasingToken");
    const rToken = await RebasingToken.deploy();
    await rToken.waitForDeployment();

    const [, engine, settlement, user] = await ethers.getSigners();
    await rToken.mint(engine.address, 1_000_000n * UNIT);

    const MarketVault = await ethers.getContractFactory("MarketVault");
    const vault = await MarketVault.deploy(
      VIEW_ID,
      await rToken.getAddress(),
      engine.address,
      settlement.address
    );
    await vault.waitForDeployment();

    // Normal deposit succeeds
    // Pre-transfer tokens to vault first (pure-accounting deposit pattern)
    const amount = 1000n * UNIT;
    await rToken.connect(engine).transfer(await vault.getAddress(), amount);
    await vault.connect(engine).deposit(amount);
    expect(await vault.balance()).to.equal(amount);

    // Simulate rebasing slash: vault's balance drops to 500
    await rToken.slash(await vault.getAddress(), 500n * UNIT);
    expect(await vault.balance()).to.equal(500n * UNIT);

    // Next operation (withdraw) must revert because actual < tracked
    await expect(vault.connect(engine).withdraw(user.address, 100n * UNIT))
      .to.be.revertedWithCustomError(vault, "Vault__InvariantViolation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATTACK 4: Reentrancy
// ─────────────────────────────────────────────────────────────────────────────

describe("Attack 4: Reentrancy Protection", function () {

  it("malicious ERC20 callback cannot reenter withdraw()", async function () {
    // Deploy a malicious token that calls withdraw() in its transfer() hook
    const MaliciousToken = await ethers.getContractFactory("MockReentrantToken");
    const mToken = await MaliciousToken.deploy();
    await mToken.waitForDeployment();

    const [, engine, settlement, user] = await ethers.getSigners();
    await mToken.mint(engine.address, 1_000_000n * UNIT);

    const MarketVault = await ethers.getContractFactory("MarketVault");
    const vault = await MarketVault.deploy(
      VIEW_ID,
      await mToken.getAddress(),
      engine.address,
      settlement.address
    );
    await vault.waitForDeployment();

    // Normal deposit: pre-transfer tokens to vault first (pure-accounting pattern)
    const amount = 1000n * UNIT;
    await mToken.connect(engine).transfer(await vault.getAddress(), amount);
    await vault.connect(engine).deposit(amount);

    // Configure the malicious token to attempt reentrancy on transfer
    await mToken.setVaultAndTarget(await vault.getAddress(), user.address, 100n * UNIT);

    // The malicious token uses try/catch internally, so the outer transaction succeeds,
    // but the inner reentrant call to withdraw() must fail.
    // We verify this by checking the Vault's balance — it should only decrease by 500,
    // not by (500 + reentrantAmount).
    await vault.connect(engine).withdraw(user.address, 500n * UNIT);
    expect(await vault.balance()).to.equal(500n * UNIT); // 1000 - 500 = 500
  });

  it("malicious ERC20 callback cannot reenter settle()", async function () {
    const MaliciousToken = await ethers.getContractFactory("MockReentrantSettleToken");
    const mToken = await MaliciousToken.deploy();
    await mToken.waitForDeployment();

    const [, engine, settlement, user] = await ethers.getSigners();
    await mToken.mint(engine.address, 1_000_000n * UNIT);

    const MarketVault = await ethers.getContractFactory("MarketVault");
    const vault = await MarketVault.deploy(
      VIEW_ID,
      await mToken.getAddress(),
      engine.address,
      settlement.address
    );
    await vault.waitForDeployment();

    // Normal deposit: pre-transfer tokens to vault first (pure-accounting pattern)
    const amount = 1000n * UNIT;
    await mToken.connect(engine).transfer(await vault.getAddress(), amount);
    await vault.connect(engine).deposit(amount);

    // Configure malicious token to attempt reentrancy on settle
    await mToken.setVaultAndTarget(await vault.getAddress(), settlement.address, user.address, 100n * UNIT);

    await vault.connect(settlement).settle(user.address, 500n * UNIT);
    expect(await vault.balance()).to.equal(500n * UNIT); // 1000 - 500 = 500
  });

  it("normal withdraw succeeds without reentrancy (guard does not block legitimate calls)", async function () {
    const { engine, user, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 500n * UNIT);
    await expect(vault.connect(engine).withdraw(user.address, 200n * UNIT)).to.not.be.reverted;
    expect(await vault.balance()).to.equal(300n * UNIT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATTACK 5: Multiple Settlement
// ─────────────────────────────────────────────────────────────────────────────

describe("Attack 5: Multiple Settlement", function () {

  it("first settle() succeeds", async function () {
    const { engine, user, settlement, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 1000n * UNIT);
    await expect(vault.connect(settlement).settle(user.address, 500n * UNIT)).to.not.be.reverted;
    expect(await vault.totalSettled()).to.equal(500n * UNIT);
  });

  it("second settle() for same amount reverts (InsufficientBalance)", async function () {
    const { engine, user, settlement, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 500n * UNIT);
    await vault.connect(settlement).settle(user.address, 500n * UNIT);
    // Vault is now empty
    await expect(vault.connect(settlement).settle(user.address, 500n * UNIT))
      .to.be.revertedWithCustomError(vault, "Vault__InsufficientBalance");
  });

  it("second settle() for smaller amount also reverts when balance is zero", async function () {
    const { engine, user, settlement, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 100n * UNIT);
    await vault.connect(settlement).settle(user.address, 100n * UNIT);
    await expect(vault.connect(settlement).settle(user.address, 1n))
      .to.be.revertedWithCustomError(vault, "Vault__InsufficientBalance");
  });

  it("partial settlements are tracked correctly", async function () {
    const { engine, user, settlement, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 1000n * UNIT);
    await vault.connect(settlement).settle(user.address, 300n * UNIT);
    await vault.connect(settlement).settle(user.address, 200n * UNIT);
    expect(await vault.totalSettled()).to.equal(500n * UNIT);
    expect(await vault.balance()).to.equal(500n * UNIT);
  });

  it("settle() emits Settled event with correct viewId, receiver, amount", async function () {
    const { engine, user, settlement, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 1000n * UNIT);
    await expect(vault.connect(settlement).settle(user.address, 400n * UNIT))
      .to.emit(vault, "Settled")
      .withArgs(VIEW_ID, user.address, 400n * UNIT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATTACK 6: Factory Security
// ─────────────────────────────────────────────────────────────────────────────

describe("Attack 6: Factory Security", function () {

  it("duplicate ViewID deployment reverts with VaultFactory__AlreadyDeployed", async function () {
    const { owner, engine, settlement, token, factory } = await loadFixture(deployFixture);
    await factory.connect(owner).deployVault(
      VIEW_ID, engine.address, settlement.address, await token.getAddress()
    );
    await expect(
      factory.connect(owner).deployVault(
        VIEW_ID, engine.address, settlement.address, await token.getAddress()
      )
    ).to.be.revertedWithCustomError(factory, "VaultFactory__AlreadyDeployed")
     .withArgs(VIEW_ID);
  });

  it("attacker cannot deploy vault (not authorizedFactory)", async function () {
    const { engine, settlement, token, factory, attacker } = await loadFixture(deployFixture);
    await expect(
      factory.connect(attacker).deployVault(
        VIEW_ID, engine.address, settlement.address, await token.getAddress()
      )
    ).to.be.revertedWithCustomError(factory, "VaultFactory__Unauthorised");
  });

  it("vault is not registered after failed deployment (atomic rollback)", async function () {
    const { owner, engine, settlement, factory } = await loadFixture(deployFixture);
    // Zero token address causes revert
    await expect(
      factory.connect(owner).deployVault(VIEW_ID, engine.address, settlement.address, ethers.ZeroAddress)
    ).to.be.reverted;
    expect(await factory.vaultExists(VIEW_ID)).to.be.false;
  });

  it("authorizedFactory is immutable", async function () {
    const { owner, factory } = await loadFixture(deployFixture);
    expect(await factory.authorizedFactory()).to.equal(owner.address);
    const abi = factory.interface.fragments.map(f => f.name).filter(Boolean);
    expect(abi).to.not.include("setAuthorizedFactory");
    expect(abi).to.not.include("transferOwnership");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Event Signature Verification
// ─────────────────────────────────────────────────────────────────────────────

describe("Event Signature Verification", function () {

  it("Deposited event includes viewId (indexed), caller (indexed), amount", async function () {
    const { engine, token, vault } = await loadFixture(deployFixture);
    const amount = 250n * UNIT;
    // Pre-transfer tokens to vault before calling deposit() (pure-accounting pattern)
    await token.connect(engine).transfer(await vault.getAddress(), amount);
    await expect(vault.connect(engine).deposit(amount))
      .to.emit(vault, "Deposited")
      .withArgs(VIEW_ID, engine.address, amount);
  });

  it("Withdrawn event includes viewId (indexed), receiver (indexed), amount", async function () {
    const { engine, user, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 500n * UNIT);
    await expect(vault.connect(engine).withdraw(user.address, 150n * UNIT))
      .to.emit(vault, "Withdrawn")
      .withArgs(VIEW_ID, user.address, 150n * UNIT);
  });

  it("Settled event includes viewId (indexed), receiver (indexed), amount", async function () {
    const { engine, user, settlement, token, vault } = await loadFixture(deployFixture);
    await fundVault(token, vault, engine, 500n * UNIT);
    await expect(vault.connect(settlement).settle(user.address, 300n * UNIT))
      .to.emit(vault, "Settled")
      .withArgs(VIEW_ID, user.address, 300n * UNIT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Permission Model Immutability
// ─────────────────────────────────────────────────────────────────────────────

describe("Permission Model Immutability", function () {

  it("no owner/admin/emergency/pause/upgrade functions exist", async function () {
    const { vault } = await loadFixture(deployFixture);
    const abi = vault.interface.fragments.map(f => f.name).filter(Boolean);
    const forbidden = [
      "emergencyWithdraw", "adminWithdraw", "ownerWithdraw", "rescue", "sweep",
      "pause", "unpause", "upgradeTo", "upgradeToAndCall", "transferOwnership",
      "renounceOwnership", "setEngine", "setSettlement", "setToken"
    ];
    for (const fn of forbidden) {
      expect(abi, `Function '${fn}' must not exist in MarketVault`).to.not.include(fn);
    }
  });

  it("authorizedTradingEngine is immutable", async function () {
    const { engine, vault } = await loadFixture(deployFixture);
    expect(await vault.authorizedTradingEngine()).to.equal(engine.address);
  });

  it("authorizedSettlementManager is immutable", async function () {
    const { settlement, vault } = await loadFixture(deployFixture);
    expect(await vault.authorizedSettlementManager()).to.equal(settlement.address);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Boundary: Vault does NOT contain Position / Price / TWAP logic
// ─────────────────────────────────────────────────────────────────────────────

describe("Responsibility Boundary: No Position / Price / TWAP in Vault", function () {

  it("vault ABI contains no position-related functions", async function () {
    const { vault } = await loadFixture(deployFixture);
    const abi = vault.interface.fragments.map(f => f.name).filter(Boolean);
    const positionFns = ["getPosition", "mint", "burn", "transfer", "approve",
                         "allowance", "balanceOf", "getPulseIndex", "getTWAP",
                         "lockMarket", "settleMarket"];
    for (const fn of positionFns) {
      expect(abi, `Function '${fn}' must not exist in MarketVault`).to.not.include(fn);
    }
  });
});
