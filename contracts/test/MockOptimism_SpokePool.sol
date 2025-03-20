// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;
import "../Ovm_SpokePool.sol";

/**
 * @notice Mock Optimism Spoke pool allowing deployer to override constructor params.
 */
contract MockOptimism_SpokePool is Ovm_SpokePool {
    // Use mock fee cap for Hyperlane xERC20 transfers
    uint256 private constant MOCK_HYP_FEE_CAP = 1 ether;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _wrappedNativeTokenAddress)
        Ovm_SpokePool(
            _wrappedNativeTokenAddress,
            1 hours,
            9 hours,
            IERC20(address(0)),
            ITokenMessenger(address(0)),
            MOCK_HYP_FEE_CAP
        )
    {} // solhint-disable-line no-empty-blocks

    function initialize(
        address l2Eth,
        uint32 _initialDepositId,
        address _crossDomainAdmin,
        address _hubPool
    ) public initializer {
        __OvmSpokePool_init(_initialDepositId, _crossDomainAdmin, _hubPool, l2Eth);
    }
}
