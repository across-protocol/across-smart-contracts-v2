// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "./SpokePool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @notice Ethereum L1 specific SpokePool. Used on Ethereum L1 to facilitate L2->L1 transfers.
 */
contract Ethereum_SpokePool is SpokePool, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    /**
     * @notice Construct the Ethereum SpokePool.
     * @param _hubPool Hub pool address to set. Can be changed by admin.
     * @param _wethAddress Weth address for this network to set.
     * @param _timerAddress Timer address to set.
     */
    function initialize(
        address _hubPool,
        address _wethAddress,
        address _timerAddress
    ) public initializer {
        __Ownable_init();
        __SpokePool_init(msg.sender, _hubPool, _wethAddress, _timerAddress);
    }

    /**************************************
     *          INTERNAL FUNCTIONS           *
     **************************************/

    function _bridgeTokensToHubPool(RelayerRefundLeaf memory relayerRefundLeaf) internal override {
        IERC20(relayerRefundLeaf.l2TokenAddress).safeTransfer(hubPool, relayerRefundLeaf.amountToReturn);
    }

    // Admin is simply owner which should be same account that owns the HubPool deployed on this network. A core
    // assumption of this contract system is that the HubPool is deployed on Ethereum.
    function _requireAdminSender() internal override onlyOwner {}
}
