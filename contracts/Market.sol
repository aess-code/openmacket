// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Market is ERC1155, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ── Token IDs ────────────────────────────────────────────────────────────
    uint256 public constant YES = 0;
    uint256 public constant NO  = 1;

    // ── Immutables ───────────────────────────────────────────────────────────
    address public immutable usdt;
    address public immutable creator;
    uint256 public immutable createdAt;

    // ── Storage ──────────────────────────────────────────────────────────────
    address public treasury;
    string  public question;
    string  public description;
    bool    public isClosed;

    uint256 public yesSupply;
    uint256 public noSupply;

    /// @notice Cumulative gross USDT traded (buy + sell, before fees)
    uint256 public totalVolume;

    /// @notice Number of unique addresses that have ever bought into this market
    uint256 public participantCount;

    /// @dev Tracks whether an address has participated (to avoid double-counting)
    mapping(address => bool) private hasParticipated;

    // ── Fee constants ────────────────────────────────────────────────────────
    uint256 private constant CREATOR_FEE_BPS  = 50;
    uint256 private constant TREASURY_FEE_BPS = 50;
    uint256 private constant BPS_DENOM        = 10_000;
    uint256 private constant SHARE_PER_USDT   = 1;

    // ── Status ───────────────────────────────────────────────────────────────
    uint8 public constant STATUS_OPEN    = 0;
    uint8 public constant STATUS_CLOSING = 1;
    uint8 public constant STATUS_SETTLED = 2;

    uint8   public status;
    uint256 public closingTimestamp;
    bool    public settledYesWins;
    bool    public isTie;
    mapping(address => bool) public claimed;

    uint256 private constant SETTLEMENT_DELAY = 21 days;

    // ── Events ───────────────────────────────────────────────────────────────
    event Bought(address indexed user, uint256 indexed side, uint256 usdtGross, uint256 sharesMinted);
    event Sold(address indexed user, uint256 indexed side, uint256 sharesBurned, uint256 usdtGross);
    event MarketClosing(address indexed closer, uint256 settlementTime);
    event MarketSettled(bool yesWins, bool tie);
    event Claimed(address indexed user, uint256 amount);

    // ── Constructor ──────────────────────────────────────────────────────────
    constructor(
        string memory _question,
        string memory _description,
        address _creator,
        address _usdt,
        address _treasury
    ) ERC1155("") Ownable(_creator) {
        question    = _question;
        description = _description;
        creator     = _creator;
        usdt        = _usdt;
        treasury    = _treasury;
        createdAt   = block.timestamp;
        status      = STATUS_OPEN;
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getConfidence() public view returns (uint256) {
        uint256 total = yesSupply + noSupply;
        if (total == 0) return 5000;
        return (yesSupply * BPS_DENOM) / total;
    }

    function getTVL() public view returns (uint256) {
        return (yesSupply + noSupply) / SHARE_PER_USDT;
    }

    function timeUntilSettlement() public view returns (uint256) {
        if (status != STATUS_CLOSING) return 0;
        if (block.timestamp >= closingTimestamp + SETTLEMENT_DELAY) return 0;
        return (closingTimestamp + SETTLEMENT_DELAY) - block.timestamp;
    }

    function getUserPosition(address user)
        external view
        returns (uint256 yesBal, uint256 noBal, uint256 yesValueUSDT, uint256 noValueUSDT)
    {
        yesBal       = balanceOf(user, YES);
        noBal        = balanceOf(user, NO);
        yesValueUSDT = yesBal / SHARE_PER_USDT;
        noValueUSDT  = noBal  / SHARE_PER_USDT;
    }

    function getClaimAmount(address user) public view returns (uint256) {
        if (status != STATUS_SETTLED) return 0;
        if (claimed[user]) return 0;
        uint256 yesBal = balanceOf(user, YES);
        uint256 noBal  = balanceOf(user, NO);
        uint256 total  = yesSupply + noSupply;
        if (total == 0) return 0;
        if (isTie) return (yesBal + noBal) / SHARE_PER_USDT;
        uint256 winBal    = settledYesWins ? yesBal : noBal;
        if (winBal == 0) return 0;
        uint256 winSupply = settledYesWins ? yesSupply : noSupply;
        return (winBal * total) / (winSupply * SHARE_PER_USDT);
    }

    // ── Mutators ─────────────────────────────────────────────────────────────

    function buy(uint256 side, uint256 usdtAmount) external nonReentrant {
        require(status == STATUS_OPEN, "Market not open");
        require(usdtAmount > 0, "Amount > 0");
        require(side == YES || side == NO, "Invalid side");

        IERC20(usdt).safeTransferFrom(msg.sender, address(this), usdtAmount);

        uint256 treasuryFee = (usdtAmount * TREASURY_FEE_BPS) / BPS_DENOM;
        uint256 creatorFee  = (usdtAmount * CREATOR_FEE_BPS)  / BPS_DENOM;
        uint256 netUsdt     = usdtAmount - treasuryFee - creatorFee;
        uint256 shares      = netUsdt * SHARE_PER_USDT;

        if (treasuryFee > 0) IERC20(usdt).safeTransfer(treasury, treasuryFee);
        if (creatorFee  > 0) IERC20(usdt).safeTransfer(creator,  creatorFee);

        if (side == YES) { yesSupply += shares; } else { noSupply += shares; }
        _mint(msg.sender, side, shares, "");

        totalVolume += usdtAmount;
        if (!hasParticipated[msg.sender]) {
            hasParticipated[msg.sender] = true;
            participantCount += 1;
        }

        emit Bought(msg.sender, side, usdtAmount, shares);
    }

    function sell(uint256 side, uint256 shares) external nonReentrant {
        require(status == STATUS_OPEN, "Market not open");
        require(shares > 0, "Shares > 0");
        require(side == YES || side == NO, "Invalid side");
        require(balanceOf(msg.sender, side) >= shares, "Insufficient balance");

        uint256 grossUsdt   = shares / SHARE_PER_USDT;
        uint256 treasuryFee = (grossUsdt * TREASURY_FEE_BPS) / BPS_DENOM;
        uint256 creatorFee  = (grossUsdt * CREATOR_FEE_BPS)  / BPS_DENOM;
        uint256 netToUser   = grossUsdt - treasuryFee - creatorFee;

        if (side == YES) { yesSupply -= shares; } else { noSupply -= shares; }
        _burn(msg.sender, side, shares);

        IERC20(usdt).safeTransfer(msg.sender, netToUser);
        if (treasuryFee > 0) IERC20(usdt).safeTransfer(treasury, treasuryFee);
        if (creatorFee  > 0) IERC20(usdt).safeTransfer(creator,  creatorFee);

        totalVolume += grossUsdt;

        emit Sold(msg.sender, side, shares, grossUsdt);
    }

    function initiateClose() external onlyOwner {
        require(status == STATUS_OPEN, "Not open");
        status           = STATUS_CLOSING;
        closingTimestamp = block.timestamp;
        isClosed         = true;
        emit MarketClosing(msg.sender, block.timestamp + SETTLEMENT_DELAY);
    }

    function settle(bool _yesWins, bool _tie) external onlyOwner {
        require(status == STATUS_CLOSING, "Not in closing");
        require(block.timestamp >= closingTimestamp + SETTLEMENT_DELAY, "Delay not passed");
        status         = STATUS_SETTLED;
        settledYesWins = _yesWins;
        isTie          = _tie;
        emit MarketSettled(_yesWins, _tie);
    }

    function claim() external nonReentrant {
        require(status == STATUS_SETTLED, "Not settled");
        require(!claimed[msg.sender], "Already claimed");
        uint256 amount = getClaimAmount(msg.sender);
        require(amount > 0, "Nothing to claim");
        claimed[msg.sender] = true;
        uint256 yesBal = balanceOf(msg.sender, YES);
        uint256 noBal  = balanceOf(msg.sender, NO);
        if (yesBal > 0) _burn(msg.sender, YES, yesBal);
        if (noBal  > 0) _burn(msg.sender, NO,  noBal);
        IERC20(usdt).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }
}
