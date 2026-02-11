// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import { TradDelegate } from "../TradDelegate.sol";

contract MockERC20 {
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "MockERC20: insufficient allowance");
        allowance[from][msg.sender] = allowed - amount;

        require(balanceOf[from] >= amount, "MockERC20: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
        return true;
    }
}

contract MockPair {
    MockERC20 public immutable token;

    constructor(MockERC20 _token) {
        token = _token;
    }

    function buy(uint256 minTokensOut, uint256 deadline) external payable {
        require(block.timestamp <= deadline, "MockPair: deadline");
        uint256 out = msg.value;
        require(out >= minTokensOut, "MockPair: slippage");
        token.mint(msg.sender, out);
    }

    function sell(uint256 tokensToSell, uint256 minEthOut, uint256 deadline) external {
        require(block.timestamp <= deadline, "MockPair: deadline");
        require(token.transferFrom(msg.sender, address(this), tokensToSell), "MockPair: transferFrom failed");

        uint256 ethOut = tokensToSell;
        require(ethOut >= minEthOut, "MockPair: slippage");

        (bool success, ) = payable(msg.sender).call{ value: ethOut }("");
        require(success, "MockPair: eth transfer failed");
    }

    receive() external payable {}
}

contract TradDelegateTest is Test {
    TradDelegate delegate;
    MockERC20 token;
    MockPair pair;

    address feeReceiver = address(0xFEE);
    address operator = address(0xBEEF);
    address guardian = address(0xCAFE);
    address user = address(0x1234);

    function setUp() public {
        delegate = new TradDelegate(feeReceiver, 50);
        delegate.setOperator(operator);
        delegate.setGuardian(guardian);

        token = new MockERC20();
        pair = new MockPair(token);

        delegate.setPairCodehashAllowed(address(pair).codehash, true);

        vm.deal(user, 10 ether);
        vm.deal(address(pair), 10 ether);
    }

    function test_executeBuy_revertsWhenPairNotAllowed() public {
        TradDelegate d = new TradDelegate(feeReceiver, 50);
        d.setOperator(operator);

        MockERC20 t = new MockERC20();
        MockPair p = new MockPair(t);

        vm.deal(user, 1 ether);
        vm.prank(user);
        d.deposit{ value: 1 ether }();

        vm.prank(operator);
        vm.expectRevert(bytes("TradDelegate: pair not allowed"));
        d.executeBuy(user, address(p), 1 ether, 0, block.timestamp + 1);
    }

    function test_executeBuyAndSell_flow_andAllowanceCleared() public {
        vm.prank(user);
        delegate.deposit{ value: 2 ether }();

        vm.prank(operator);
        delegate.executeBuy(user, address(pair), 1 ether, 0, block.timestamp + 1);

        uint256 feeOnBuy = (1 ether * 50) / 10000;
        uint256 buyAmount = 1 ether - feeOnBuy;

        assertEq(delegate.balanceOf(user), 1 ether);
        assertEq(delegate.tokenBalanceOf(user, address(token)), buyAmount);
        assertEq(feeReceiver.balance, feeOnBuy);

        uint256 tokensToSell = 5e17; // 0.5 tokens (18 decimals)
        vm.prank(operator);
        delegate.executeSell(user, address(pair), tokensToSell, 0, block.timestamp + 1);

        uint256 feeOnSell = (tokensToSell * 50) / 10000;
        uint256 userProceeds = tokensToSell - feeOnSell;

        assertEq(token.allowance(address(delegate), address(pair)), 0);
        assertEq(delegate.tokenBalanceOf(user, address(token)), buyAmount - tokensToSell);
        assertEq(delegate.balanceOf(user), 1 ether + userProceeds);
        assertEq(feeReceiver.balance, feeOnBuy + feeOnSell);
    }

    function test_withdraw_worksWhenPaused() public {
        vm.prank(user);
        delegate.deposit{ value: 1 ether }();

        vm.prank(guardian);
        delegate.pause();

        vm.prank(user);
        delegate.withdrawAll();

        assertEq(delegate.balanceOf(user), 0);
    }

    function test_guardian_cannotUnpause() public {
        vm.prank(guardian);
        delegate.pause();

        vm.prank(guardian);
        vm.expectRevert(bytes("TradDelegate: caller is not the owner"));
        delegate.unpause();

        delegate.unpause();
        assertEq(delegate.paused(), false);
    }

    function test_withdrawTokens() public {
        vm.prank(user);
        delegate.deposit{ value: 1 ether }();

        vm.prank(operator);
        delegate.executeBuy(user, address(pair), 1 ether, 0, block.timestamp + 1);

        uint256 feeOnBuy = (1 ether * 50) / 10000;
        uint256 buyAmount = 1 ether - feeOnBuy;

        vm.prank(user);
        delegate.withdrawTokens(address(token), buyAmount);

        assertEq(token.balanceOf(user), buyAmount);
        assertEq(delegate.tokenBalanceOf(user, address(token)), 0);
    }
}

