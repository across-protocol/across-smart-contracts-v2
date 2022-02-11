//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@eth-optimism/contracts/libraries/bridge/CrossDomainEnabled.sol";
import "@eth-optimism/contracts/libraries/constants/Lib_PredeployAddresses.sol";
import "@eth-optimism/contracts/L2/messaging/IL2ERC20Bridge.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./SpokePool.sol";
import "./SpokePoolInterface.sol";

/**
 * @notice OVM specific SpokePool.
 * @dev Uses OVM cross-domain-enabled logic for access control.
 */

contract Optimism_SpokePool is CrossDomainEnabled, SpokePoolInterface, SpokePool, Ownable {
    // "l1Gas" parameter used in call to bridge tokens from this contract back to L1 via `IL2ERC20Bridge`.
    uint32 l1Gas = 6_000_000;

    event OptimismTokensBridged(address indexed l2Token, address target, uint256 numberOfTokensBridged, uint256 l1Gas);

    constructor(
        address _crossDomainAdmin,
        address _hubPool,
        address _wethAddress,
        uint64 _depositQuoteTimeBuffer,
        address timerAddress
    )
        CrossDomainEnabled(Lib_PredeployAddresses.L2_CROSS_DOMAIN_MESSENGER)
        SpokePool(_crossDomainAdmin, _hubPool, _wethAddress, _depositQuoteTimeBuffer, timerAddress)
    {}

    /**************************************
     *          ADMIN FUNCTIONS           *
     **************************************/
    function setL1GasLimit(uint32 newl1Gas) public onlyOwner nonReentrant {
        l1Gas = newl1Gas;
    }

    /**************************************
     *    CROSS-CHAIN ADMIN FUNCTIONS     *
     **************************************/

    /**
     * @notice Changes the L1 contract that can trigger admin functions on this contract.
     * @dev This should be set to the address of the L1 contract that ultimately relays a cross-domain message, which
     * is expected to be the Optimism_Adapter.
     * @dev Only callable by the existing admin via the Optimism cross domain messenger.
     * @param newCrossDomainAdmin address of the new L1 admin contract.
     */
    function setCrossDomainAdmin(address newCrossDomainAdmin)
        public
        override
        onlyFromCrossDomainAccount(crossDomainAdmin)
        nonReentrant
    {
        _setCrossDomainAdmin(newCrossDomainAdmin);
    }

    function setHubPool(address newHubPool) public override onlyFromCrossDomainAccount(crossDomainAdmin) nonReentrant {
        _setHubPool(newHubPool);
    }

    function setEnableRoute(
        address originToken,
        uint256 destinationChainId,
        bool enable
    ) public override onlyFromCrossDomainAccount(crossDomainAdmin) nonReentrant {
        _setEnableRoute(originToken, destinationChainId, enable);
    }

    function setDepositQuoteTimeBuffer(uint64 buffer)
        public
        override
        onlyFromCrossDomainAccount(crossDomainAdmin)
        nonReentrant
    {
        _setDepositQuoteTimeBuffer(buffer);
    }

    function initializeRelayerRefund(bytes32 relayerRepaymentDistributionRoot, bytes32 slowRelayRoot)
        public
        override
        onlyFromCrossDomainAccount(crossDomainAdmin)
        nonReentrant
    {
        _initializeRelayerRefund(relayerRepaymentDistributionRoot, slowRelayRoot);
    }

    function _bridgeTokensToHubPool(DestinationDistributionLeaf memory distributionLeaf) internal override {
        // TODO: Handle WETH token unwrapping
        IL2ERC20Bridge(Lib_PredeployAddresses.L2_STANDARD_BRIDGE).withdrawTo(
            distributionLeaf.l2TokenAddress, // _l2Token. Address of the L2 token to bridge over.
            hubPool, // _to. Withdraw, over the bridge, to the l1 pool contract.
            distributionLeaf.amountToReturn, // _amount. Send the full balance of the deposit box to bridge.
            l1Gas, // _l1Gas. Unused, but included for potential forward compatibility considerations
            "" // _data. We don't need to send any data for the bridging action.
        );
        emit OptimismTokensBridged(distributionLeaf.l2TokenAddress, hubPool, distributionLeaf.amountToReturn, l1Gas);
    }
}
