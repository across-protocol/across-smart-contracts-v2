// SPDX-License-Identifier: BUSL-1.1

// Arbitrum only supports v0.8.19
// See https://docs.arbitrum.io/for-devs/concepts/differences-between-arbitrum-ethereum/solidity-support#differences-from-solidity-on-ethereum
pragma solidity ^0.8.19;

import "./Arbitrum_SpokePool.sol";

/**
 * @notice AVM specific SpokePool. Uses AVM cross-domain-enabled logic to implement admin only access to functions.
 * @custom:security-contact bugs@across.to
 */
contract AlephZero_SpokePool is Arbitrum_SpokePool {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address _wrappedNativeTokenAddress,
        uint32 _depositQuoteTimeBuffer,
        uint32 _fillDeadlineBuffer,
        IERC20 _l2Usdc,
        ITokenMessenger _cctpTokenMessenger,
        // _oftFeeCap can be set to 0 for AlephZero_SpokePool as it does not support OFT transfers.
        uint256 _oftFeeCap,
        // _hypXERC20FeeCap can be set to 0 for AlephZero_SpokePool as it does not support xERC20 transfers.
        uint256 _hypXERC20FeeCap
    )
        Arbitrum_SpokePool(
            _wrappedNativeTokenAddress,
            _depositQuoteTimeBuffer,
            _fillDeadlineBuffer,
            _l2Usdc,
            _cctpTokenMessenger,
            _oftFeeCap,
            _hypXERC20FeeCap
        )
    {} // solhint-disable-line no-empty-blocks
}
