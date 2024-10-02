// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MultiCaller } from "@uma/core/contracts/common/implementation/MultiCaller.sol";
import { CircleCCTPAdapter, ITokenMessenger, CircleDomainIds } from "../../libraries/CircleCCTPAdapter.sol";

/**
 * @title WithdrawalAdapterBase
 * @notice This contract contains general configurations for bridging tokens from an L2 to a single recipient on L1.
 * @dev This contract should be deployed on L2. It provides an interface to withdraw tokens to some address on L1. The only
 * function which must be implemented in contracts which inherit this contract is `withdrawToken`. It is up to that function
 * to determine which bridges to use for an input L2 token. Importantly, that function must also verify that the l2 to l1
 * token mapping is correct so that the bridge call itself can succeed.
 */
abstract contract WithdrawalAdapterBase is CircleCCTPAdapter, MultiCaller {
    using SafeERC20 for IERC20;

    // The L1 address which will unconditionally receive all withdrawals from this contract.
    address public immutable TOKEN_RECIPIENT;
    // The address of the primary or default token gateway/canonical bridge contract on L2.
    address public immutable L2_TOKEN_GATEWAY;

    /*
     * @notice Constructs a new withdrawal adapter.
     * @param _l2Usdc Address of native USDC on the L2.
     * @param _cctpTokenMessenger Address of the CCTP token messenger contract on L2.
     * @param _destinationCircleDomainId Circle's assigned CCTP domain ID for the destination network.
     * @param _l2TokenGateway Address of the network's l2 token gateway/bridge contract.
     * @param _tokenRecipient L1 address which will unconditionally receive all withdrawals originating from this contract.
     */
    constructor(
        IERC20 _l2Usdc,
        ITokenMessenger _cctpTokenMessenger,
        uint32 _destinationCircleDomainId,
        address _l2TokenGateway,
        address _tokenRecipient
    ) CircleCCTPAdapter(_l2Usdc, _cctpTokenMessenger, _destinationCircleDomainId) {
        L2_TOKEN_GATEWAY = _l2TokenGateway;
        TOKEN_RECIPIENT = _tokenRecipient;
    }

    /*
     * @notice Withdraws a specified token to L1. This may be implemented uniquely for each L2, since each L2 has various
     * dependencies to withdraw a token, such as the token bridge to use, mappings for L1 and L2 tokens, and gas configurations.
     * Notably, withdrawals should always send token back to `TOKEN_RECIPIENT`.
     * @param l1Token Address of the l1Token to receive.
     * @param l2Token Address of the l2Token to send back.
     * @param amountToReturn Amount of l2Token to send back.
     * @dev Some networks do not require the L1/L2 token argument to withdraw tokens, while others enable contracts to derive the
     * L1/L2 given knowledge of only one of the addresses. Both arguments are provided to enable a flexible interface; however, due
     * to this, `withdrawToken` MUST account for situations where the L1/L2 token mapping is incorrect.
     */
    function withdrawToken(
        address l1Token,
        address l2Token,
        uint256 amountToReturn
    ) public virtual;
}