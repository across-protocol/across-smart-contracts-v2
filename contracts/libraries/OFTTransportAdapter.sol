// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IOFT, SendParam, MessagingFee } from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import { AddressToBytes32 } from "../libraries/AddressConverters.sol";

/**
 * @notice Facilitate bridging USDT via LayerZero's OFT.
 * @dev This contract is intended to be inherited by other chain-specific adapters and spoke pools. This contract is built for 1-to-1 relationship with USDT to facilitate USDT0. When adding other contracts, we'd need to add a token mapping instead of the immutable token address.
 * @custom:security-contact bugs@across.to
 */
contract OFTTransportAdapter {
    using SafeERC20 for IERC20;
    using AddressToBytes32 for address;

    bytes public constant EMPTY_MSG_BYTES = new bytes(0);
    address public constant ZERO_ADDRESS = address(0);

    // USDT address on current chain.
    IERC20 public immutable usdt;
    // Mailbox address for OFT cross-chain transfers.
    IOFT public immutable oftMessenger;

    /**
     * @notice The destination endpoint id in the OFT messaging protocol.
     * @dev Source https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts.
     * @dev Can also be found on target chain OFTAdapter -> endpoint() -> eid().
     */
    uint32 public immutable dstEid;

    /**
     * @notice intiailizes the OFTTransportAdapter contract.
     * @param _usdt USDT address on the current chain.
     * @param _oftMessenger OFTAdapter contract to bridge to the other chain. If address is set to zero, OFT bridging will be disabled.
     * @param _dstEid The endpoint ID that OFT will transfer funds to.
     */
    constructor(IERC20 _usdt, IOFT _oftMessenger, uint32 _dstEid) {
        usdt = _usdt;
        oftMessenger = _oftMessenger;
        dstEid = _dstEid;
    }

    /**
     * @notice Returns whether or not the OFT bridge is enabled.
     * @dev If the IOFT is the zero address, OFT bridging is disabled.
     */
    function _isOFTEnabled(address _token) internal view returns (bool) {
        return address(oftMessenger) != address(0) && address(usdt) == _token;
    }

    /**
     * @notice transfers usdt to destination endpoint
     * @param _to address to receive a trasnfer on the destination chain
     * @param _amount amount to send
     */
    function _transferUsdt(address _to, uint256 _amount) internal {
        bytes32 to = _to.toBytes32();

        // todo: should probably just comment these 2 vars and use `_amount` in send call below
        // `amountLD` and `minAmountLD` have a subtle relationship. OFT "removes dust" on .send, which should not affect USDT transfer because of how OFT works internally with 6-decimal tokens.
        // Setting these two equal protects us from dust subtraction on the OFT side. If any dust is subtracted, the later .send should revert. Should be cautious with this logic.
        uint256 amountLD = _amount;
        uint256 minAmountLD = _amount;

        SendParam memory sendParam = SendParam(
            dstEid,
            to,
            amountLD,
            minAmountLD,
            EMPTY_MSG_BYTES,
            EMPTY_MSG_BYTES,
            EMPTY_MSG_BYTES
        );

        MessagingFee memory fee = oftMessenger.quoteSend(sendParam, false);

        // todo: here, we're relying on `oftMessenger` to use the full allowance. Otherwise, next .safeApprove will revert.
        usdt.safeApprove(address(this), _amount);

        // todo: not really sure if we should blindly trust the fee.nativeFee here and just send it away. Should we check it against some sane cap?
        // setting refundAddress to zero addr here, because we calculate the fees precicely and we can save gas this way
        oftMessenger.send{ value: fee.nativeFee }(sendParam, fee, ZERO_ADDRESS);

        // todo: OFTAdapter enforces this, but should we check anyway?
        // return vals from .send: (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt)
        // require(amount == oftReceipt.amountSentLD);
        // require(amount == oftReceipt.amountReceivedLD);
    }
}
