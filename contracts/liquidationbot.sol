// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IFlashLoanSimpleReceiver} from "@aave/core-v3/contracts/flashloan/interfaces/IFlashLoanSimpleReceiver.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

contract LiquidationBot is IFlashLoanSimpleReceiver, Ownable {
    using SafeERC20 for IERC20;

    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    IPool public immutable POOL;
    ISwapRouter public immutable swapRouter;

    address public executor;

    constructor(
        address _provider,
        address _swapRouter
    ) {
        ADDRESSES_PROVIDER = IPoolAddressesProvider(_provider);
        POOL = IPool(ADDRESSES_PROVIDER.getPool());
        swapRouter = ISwapRouter(_swapRouter);
        executor = msg.sender;
    }

    modifier onlyExecutor() {
        require(msg.sender == executor, "Not authorized");
        _;
    }

    function setExecutor(address _exec) external onlyOwner {
        executor = _exec;
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Only pool can call");
        require(initiator == address(this), "Not from contract");

        (address user, address debtAsset, address collateralAsset, bool receiveAToken) = abi.decode(
            params,
            (address, address, address, bool)
        );

        IERC20(debtAsset).safeApprove(address(POOL), amount);

        POOL.liquidationCall(
            collateralAsset,
            debtAsset,
            user,
            amount,
            receiveAToken
        );

        if (collateralAsset != asset) {
            uint256 collateralBalance = IERC20(collateralAsset).balanceOf(address(this));
            IERC20(collateralAsset).safeApprove(address(swapRouter), collateralBalance);

            ISwapRouter.ExactInputSingleParams memory swapParams = ISwapRouter.ExactInputSingleParams({
                tokenIn: collateralAsset,
                tokenOut: asset,
                fee: 3000,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: collateralBalance,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

            swapRouter.exactInputSingle(swapParams);
        }

        uint256 totalDebt = amount + premium;
        IERC20(asset).safeApprove(address(POOL), totalDebt);
		
		// Automatic profit withdrawal to the owner
        uint256 profitBalance = IERC20(asset).balanceOf(address(this)) - totalDebt;
        if (profitBalance > 0) {
        IERC20(asset).safeTransfer(owner(), profitBalance);
}

        return true;
    }

    function initiateFlashLoan(
        address asset,
        uint256 amount,
        address userToLiquidate,
        address debtAsset,
        address collateralAsset,
        bool receiveAToken
    ) external onlyExecutor {
        bytes memory params = abi.encode(userToLiquidate, debtAsset, collateralAsset, receiveAToken);
        POOL.flashLoanSimple(address(this), asset, amount, params, 0);
    }

    function withdrawERC20(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(msg.sender, bal);
    }

    function getPool() external view override returns (IPool) {
        return POOL;
    }

    receive() external payable {}
}
