// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
import "@eth-optimism/contracts/libraries/constants/Lib_PredeployAddresses.sol";

import "./Ovm_SpokePool.sol";

/**
 * @notice Optimism Spoke pool.
 */
contract Optimism_SpokePool is Ovm_SpokePool {
    /**
     * @notice Construct the OVM Optimism SpokePool.
     * @param _crossDomainAdmin Cross domain admin to set. Can be changed by admin.
     * @param _hubPool Hub pool address to set. Can be changed by admin.
     * @param timerAddress Timer address to set.
     */
    constructor(
        address _crossDomainAdmin,
        address _hubPool,
        address timerAddress
    )
        Ovm_SpokePool(
            _crossDomainAdmin,
            _hubPool,
            Lib_PredeployAddresses.OVM_ETH,
            0x4200000000000000000000000000000000000006,
            timerAddress
        )
    {}
}
