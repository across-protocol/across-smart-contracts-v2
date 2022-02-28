// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./Base_Adapter.sol";
import "../interfaces/AdapterInterface.sol";
import "../interfaces/WETH9.sol";

import "@eth-optimism/contracts/libraries/bridge/CrossDomainEnabled.sol";
import "@eth-optimism/contracts/L1/messaging/IL1StandardBridge.sol";
import "../Lockable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IRootChainManager {
    function depositEtherFor(address user) external payable;

    function depositFor(
        address user,
        address rootToken,
        bytes calldata depositData
    ) external;
}

interface IFxStateSender {
    function sendMessageToChild(address _receiver, bytes calldata _data) external;
}

/**
 * @notice Sends cross chain messages Polygon L2 network.
 */
contract Polygon_Adapter is Base_Adapter, Lockable {
    using SafeERC20 for IERC20;
    IRootChainManager public rootChainManager;
    IFxStateSender public fxStateSender;
    WETH9 public l1Weth;

    constructor(
        address _hubPool,
        IRootChainManager _rootChainManager,
        IFxStateSender _fxStateSender,
        WETH9 _l1Weth
    ) Base_Adapter(_hubPool) {
        rootChainManager = _rootChainManager;
        fxStateSender = _fxStateSender;
        l1Weth = _l1Weth;
    }

    function relayMessage(address target, bytes memory message) external payable override nonReentrant onlyHubPool {
        fxStateSender.sendMessageToChild(target, message);
        emit MessageRelayed(target, message);
    }

    function relayTokens(
        address l1Token,
        address l2Token,
        uint256 amount,
        address to
    ) external payable override nonReentrant onlyHubPool {
        // If the l1Token is weth then unwrap it to ETH then send the ETH to the standard bridge.
        if (l1Token == address(l1Weth)) {
            l1Weth.withdraw(amount);
            rootChainManager.depositEtherFor{ value: amount }(to);
        } else {
            IERC20(l1Token).safeIncreaseAllowance(address(rootChainManager), amount);
            rootChainManager.depositFor(to, l1Token, abi.encode(amount));
        }
        emit TokensRelayed(l1Token, l2Token, amount, to);
    }

    // Added to enable the Polygon_Adapter to receive ETH. used when unwrapping WETH.
    receive() external payable {}
}
