// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface IRobinPumpPair {
    function buy(uint256 minTokensOut, uint256 deadline) external payable;
    function sell(uint256 tokensToSell, uint256 minEthOut, uint256 deadline) external;
    function token() external view returns (address);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

// ─── TradDelegate ───────────────────────────────────────────────────────────

/// @title TradDelegate
/// @notice Custodial delegation contract — users deposit ETH and an authorized
///         operator (the trad server) executes RobinPump trades on their behalf.
///         Users can withdraw funds at any time, even when trading is paused.
contract TradDelegate {

    // ── Ownable ─────────────────────────────────────────────────────────────

    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == _owner, "TradDelegate: caller is not the owner");
        _;
    }

    function owner() external view returns (address) {
        return _owner;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "TradDelegate: new owner is the zero address");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }

    // ── ReentrancyGuard ─────────────────────────────────────────────────────

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus;

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "TradDelegate: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ── Pausable ────────────────────────────────────────────────────────────

    bool private _paused;
    address public guardian;

    event Paused(address account);
    event Unpaused(address account);
    event GuardianChanged(address indexed previousGuardian, address indexed newGuardian);

    modifier whenNotPaused() {
        require(!_paused, "TradDelegate: paused");
        _;
    }

    function paused() external view returns (bool) {
        return _paused;
    }

    function pause() external {
        require(
            msg.sender == _owner || msg.sender == guardian,
            "TradDelegate: caller cannot pause"
        );
        require(!_paused, "TradDelegate: already paused");
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        require(_paused, "TradDelegate: not paused");
        _paused = false;
        emit Unpaused(msg.sender);
    }

    // ── State ───────────────────────────────────────────────────────────────

    /// @notice Authorized operator address (the trad server) that can execute trades.
    address public operator;

    /// @notice Allowlisted RobinPump pair contracts by address (owner-managed).
    mapping(address => bool) public allowedPairs;

    /// @notice Allowlisted RobinPump pair contracts by runtime codehash (EXTCODEHASH).
    mapping(bytes32 => bool) public allowedPairCodehashes;

    /// @notice Address that receives platform fees.
    address public feeReceiver;

    /// @notice Platform fee in basis points (e.g. 50 = 0.5%). Max 1000 (10%).
    uint256 public fee;

    /// @dev User ETH balances held by the contract.
    mapping(address => uint256) private _balances;

    /// @dev User token balances held by the contract (user => token => amount).
    mapping(address => mapping(address => uint256)) private _tokenBalances;

    // ── Events ──────────────────────────────────────────────────────────────

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event TokenWithdraw(address indexed user, address indexed token, uint256 amount);
    event OperatorChanged(address indexed previousOperator, address indexed newOperator);
    event FeeChanged(uint256 previousFee, uint256 newFee);
    event FeeReceiverChanged(address indexed previousReceiver, address indexed newReceiver);
    event PairAllowed(address indexed pair, bool allowed);
    event PairCodehashAllowed(bytes32 indexed codehash, bool allowed);
    event BuyExecuted(
        address indexed user,
        address indexed pair,
        uint256 ethSpent,
        uint256 tokensReceived,
        uint256 feeTaken
    );
    event SellExecuted(
        address indexed user,
        address indexed pair,
        uint256 tokensSold,
        uint256 ethReceived,
        uint256 feeTaken
    );

    // ── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOperator() {
        require(msg.sender == operator, "TradDelegate: caller is not the operator");
        _;
    }

    // ── Constructor ─────────────────────────────────────────────────────────

    /// @param _feeReceiver Address that receives trading fees.
    /// @param _fee         Fee in basis points (50 = 0.5%). Must be <= 1000.
    constructor(address _feeReceiver, uint256 _fee) {
        require(_feeReceiver != address(0), "TradDelegate: fee receiver is zero address");
        require(_fee <= 1000, "TradDelegate: fee exceeds 10%");

        _owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);

        feeReceiver = _feeReceiver;
        fee = _fee;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ── Deposits ────────────────────────────────────────────────────────────

    /// @notice Deposit ETH into the contract for the operator to trade with.
    function deposit() external payable whenNotPaused {
        require(msg.value > 0, "TradDelegate: zero deposit");
        _balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice Check a user's deposited ETH balance.
    function balanceOf(address user) external view returns (uint256) {
        return _balances[user];
    }

    /// @notice Check a user's token balance held by the contract.
    function tokenBalanceOf(address user, address token) external view returns (uint256) {
        return _tokenBalances[user][token];
    }

    /// @notice Check whether a pair contract is allowlisted for trading.
    function isPairAllowed(address pair) public view returns (bool) {
        if (pair.code.length == 0) return false;
        if (allowedPairs[pair]) return true;
        return allowedPairCodehashes[pair.codehash];
    }

    // ── Withdrawals ─────────────────────────────────────────────────────────
    // NOTE: Withdrawals are always allowed, even when paused, so users can
    // always recover their funds.

    /// @notice Withdraw a specific amount of ETH.
    function withdraw(uint256 amount) external nonReentrant {
        require(_balances[msg.sender] >= amount, "TradDelegate: insufficient balance");
        _balances[msg.sender] -= amount;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "TradDelegate: ETH transfer failed");

        emit Withdraw(msg.sender, amount);
    }

    /// @notice Withdraw entire ETH balance.
    function withdrawAll() external nonReentrant {
        uint256 amount = _balances[msg.sender];
        require(amount > 0, "TradDelegate: no balance");
        _balances[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "TradDelegate: ETH transfer failed");

        emit Withdraw(msg.sender, amount);
    }

    /// @notice Withdraw tokens held by the contract back to the caller.
    function withdrawTokens(address token, uint256 amount) external nonReentrant {
        require(
            _tokenBalances[msg.sender][token] >= amount,
            "TradDelegate: insufficient token balance"
        );
        _tokenBalances[msg.sender][token] -= amount;

        _callOptionalReturn(
            token,
            abi.encodeWithSelector(IERC20.transfer.selector, msg.sender, amount),
            "TradDelegate: token transfer failed"
        );

        emit TokenWithdraw(msg.sender, token, amount);
    }

    // ── Operator Management ─────────────────────────────────────────────────

    /// @notice Set the emergency guardian (can pause, cannot unpause).
    function setGuardian(address newGuardian) external onlyOwner {
        emit GuardianChanged(guardian, newGuardian);
        guardian = newGuardian;
    }

    /// @notice Set the authorized operator address (owner-only).
    function setOperator(address newOperator) external onlyOwner {
        emit OperatorChanged(operator, newOperator);
        operator = newOperator;
    }

    /// @notice Set the platform fee in basis points (owner-only). Max 1000 (10%).
    function setFee(uint256 newFee) external onlyOwner {
        require(newFee <= 1000, "TradDelegate: fee exceeds 10%");
        emit FeeChanged(fee, newFee);
        fee = newFee;
    }

    /// @notice Set the fee receiver address (owner-only).
    function setFeeReceiver(address newFeeReceiver) external onlyOwner {
        require(newFeeReceiver != address(0), "TradDelegate: fee receiver is zero address");
        emit FeeReceiverChanged(feeReceiver, newFeeReceiver);
        feeReceiver = newFeeReceiver;
    }

    // ── Pair Allowlist Management ───────────────────────────────────────────

    /// @notice Allow or disallow a specific pair contract address (owner-only).
    function setPairAllowed(address pair, bool allowed) external onlyOwner {
        require(pair != address(0), "TradDelegate: pair is the zero address");
        if (allowed) {
            require(pair.code.length > 0, "TradDelegate: pair has no code");
        }
        allowedPairs[pair] = allowed;
        emit PairAllowed(pair, allowed);
    }

    /// @notice Allow or disallow a pair runtime codehash (owner-only).
    /// @dev Use `cast codehash <PAIR_ADDRESS>` to obtain the codehash.
    function setPairCodehashAllowed(bytes32 codehash, bool allowed) external onlyOwner {
        require(codehash != bytes32(0), "TradDelegate: codehash is zero");
        allowedPairCodehashes[codehash] = allowed;
        emit PairCodehashAllowed(codehash, allowed);
    }

    // ── Trading ─────────────────────────────────────────────────────────────

    /// @notice Buy tokens on a RobinPump bonding curve on behalf of a user.
    ///         The platform fee is deducted from ethAmount before the buy.
    /// @param user          The user whose deposited ETH funds the trade.
    /// @param pair          The RobinPump bonding-curve pair contract.
    /// @param ethAmount     Total ETH to spend (including fee).
    /// @param minTokensOut  Minimum tokens to receive (slippage protection).
    /// @param deadline      Unix timestamp deadline for the trade.
    function executeBuy(
        address user,
        address pair,
        uint256 ethAmount,
        uint256 minTokensOut,
        uint256 deadline
    ) external onlyOperator whenNotPaused nonReentrant {
        require(pair.code.length > 0, "TradDelegate: pair has no code");
        require(isPairAllowed(pair), "TradDelegate: pair not allowed");
        require(_balances[user] >= ethAmount, "TradDelegate: insufficient user balance");

        // Deduct full amount from user's ETH balance
        _balances[user] -= ethAmount;

        // Calculate platform fee
        uint256 feeTaken = (ethAmount * fee) / 10000;
        uint256 buyAmount = ethAmount - feeTaken;

        // Resolve the token address from the pair
        address token = IRobinPumpPair(pair).token();
        require(token != address(0), "TradDelegate: pair token is zero address");
        require(token.code.length > 0, "TradDelegate: token has no code");

        // Snapshot token balance before buy
        uint256 tokensBefore = IERC20(token).balanceOf(address(this));

        // Execute the buy on the bonding curve
        IRobinPumpPair(pair).buy{value: buyAmount}(minTokensOut, deadline);

        // Calculate tokens received
        uint256 tokensReceived = IERC20(token).balanceOf(address(this)) - tokensBefore;

        // Credit tokens to user
        _tokenBalances[user][token] += tokensReceived;

        // Transfer fee to fee receiver
        if (feeTaken > 0) {
            (bool success, ) = payable(feeReceiver).call{value: feeTaken}("");
            require(success, "TradDelegate: fee transfer failed");
        }

        emit BuyExecuted(user, pair, ethAmount, tokensReceived, feeTaken);
    }

    /// @notice Sell tokens on a RobinPump bonding curve on behalf of a user.
    ///         The platform fee is deducted from ETH proceeds after the sell.
    /// @param user          The user whose tokens are being sold.
    /// @param pair          The RobinPump bonding-curve pair contract.
    /// @param tokenAmount   Number of tokens to sell.
    /// @param minEthOut     Minimum ETH to receive (slippage protection).
    /// @param deadline      Unix timestamp deadline for the trade.
    function executeSell(
        address user,
        address pair,
        uint256 tokenAmount,
        uint256 minEthOut,
        uint256 deadline
    ) external onlyOperator whenNotPaused nonReentrant {
        require(pair.code.length > 0, "TradDelegate: pair has no code");
        require(isPairAllowed(pair), "TradDelegate: pair not allowed");

        address token = IRobinPumpPair(pair).token();
        require(token != address(0), "TradDelegate: pair token is zero address");
        require(token.code.length > 0, "TradDelegate: token has no code");

        require(
            _tokenBalances[user][token] >= tokenAmount,
            "TradDelegate: insufficient user token balance"
        );

        // Deduct tokens from user's balance
        _tokenBalances[user][token] -= tokenAmount;

        // Approve pair to spend tokens
        _callOptionalReturn(
            token,
            abi.encodeWithSelector(IERC20.approve.selector, pair, 0),
            "TradDelegate: token approve reset failed"
        );
        _callOptionalReturn(
            token,
            abi.encodeWithSelector(IERC20.approve.selector, pair, tokenAmount),
            "TradDelegate: token approve failed"
        );

        // Snapshot ETH balance before sell
        uint256 ethBefore = address(this).balance;

        // Execute the sell on the bonding curve
        IRobinPumpPair(pair).sell(tokenAmount, minEthOut, deadline);

        // Clear allowance (defense-in-depth)
        _callOptionalReturn(
            token,
            abi.encodeWithSelector(IERC20.approve.selector, pair, 0),
            "TradDelegate: token approve cleanup failed"
        );

        // Calculate ETH received
        uint256 ethReceived = address(this).balance - ethBefore;

        // Calculate platform fee on proceeds
        uint256 feeTaken = (ethReceived * fee) / 10000;
        uint256 userProceeds = ethReceived - feeTaken;

        // Credit net ETH to user
        _balances[user] += userProceeds;

        // Transfer fee to fee receiver
        if (feeTaken > 0) {
            (bool success, ) = payable(feeReceiver).call{value: feeTaken}("");
            require(success, "TradDelegate: fee transfer failed");
        }

        emit SellExecuted(user, pair, tokenAmount, ethReceived, feeTaken);
    }

    // ── Receive ETH ─────────────────────────────────────────────────────────
    // Required to receive ETH from RobinPump pair.sell() calls.

    receive() external payable {}

    // ── ERC-20 helpers ──────────────────────────────────────────────────────

    function _callOptionalReturn(address token, bytes memory data, string memory errorMessage) private {
        (bool success, bytes memory returndata) = token.call(data);
        require(success, errorMessage);
        if (returndata.length == 0) return;
        require(returndata.length >= 32, errorMessage);
        require(abi.decode(returndata, (bool)), errorMessage);
    }
}
