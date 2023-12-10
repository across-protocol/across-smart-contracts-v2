// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

// Contains structs and functions used by SpokePool contracts to facilitate universal settlement.
interface USSSpokePoolInterface {
    // This struct represents the data to fully specify a **unique** relay. This data is hashed and saved by the SpokePool
    // to prevent collisions. If any portion of this data differs, the relay is considered to be completely distinct.
    struct USSRelayData {
        // The address that made the deposit on the origin chain.
        address depositor;
        // The recipient address on the destination chain.
        address recipient;
        // If this address is not 0x0, then only this address can fill the deposit. Consider this therefore a
        // "committed relayer" address.
        address relayer;
        // Token that is deposited on origin chain by depositor.
        address inputToken;
        // Token that is received on destination chain by recipient.
        address outputToken;
        // The amount of input token deposited by depositor.
        uint256 inputAmount;
        // The amount of output token to be received by recipient.
        uint256 outputAmount;
        // Origin chain id.
        uint256 originChainId;
        // Destination chain id.
        uint256 destinationChainId;
        // The id uniquely identifying this deposit on the origin chain.
        uint32 depositId;
        // The timestamp on the destination chain after which this deposit can no longer be filled.
        uint32 fillDeadline;
        // Data that is forwarded to the recipient.
        bytes message;
    }

    struct USSSlowFill {
        USSRelayData relayData;
        int256 payoutAdjustmentPct;
    }

    struct USSRelayerRefundLeaf {
        // This is the amount to return to the HubPool. This occurs when there is a PoolRebalanceLeaf netSendAmount that
        // is negative. This is just the negative of this value.
        uint256 amountToReturn;
        // Used to verify that this is being executed on the correct destination chainId.
        uint256 chainId;
        // This array designates how much each of those addresses should be refunded.
        uint256[] refundAmounts;
        // Used as the index in the bitmap to track whether this leaf has been executed or not.
        uint32 leafId;
        // The associated L2TokenAddress that these claims apply to.
        address l2TokenAddress;
        // Must be same length as refundAmounts and designates each address that must be refunded.
        address[] refundAddresses;
        // Merkle tree containing each of the fills refunded by this leaf and accounted for in refundAmounts
        // and refundAddresses. The MerkleLeaf structure should be defined in the ACROSS-V2 UMIP, as there is no
        // logic in this contract that supports proving leaf inclusion in this root.
        bytes32 fillsRefundedRoot;
        // Storage layer hash of the file containing all leaves in the fillsRefundedRoot.
        string fillsRefundedHash;
    }

    // Contains information about a relay to be sent along with additional information that is not unique to the
    // relay itself but is required to know how to process the relay. For example, "updatedX" fields can be used
    // by the relayer to modify fields of the relay with the depositor's permission, and "repaymentChainId" is specified
    // by the relayer to determine where to take a relayer refund, but doesn't affect the uniqueness of the relay.
    struct USSRelayExecution {
        USSRelayData relay;
        bytes32 relayHash;
        uint256 updatedOutputAmount;
        address updatedRecipient;
        bytes updatedMessage;
        uint256 repaymentChainId;
        bool slowFill;
        int256 payoutAdjustmentPct;
    }

    // @dev The following deposit parameters are packed into structs to avoid stack too deep errors when
    // emitting events like FundsDeposited/FilledRelay that emit
    // a lot of individual parameters.

    /// @dev tokens that need to be sent from the offerer in order to satisfy an order.
    struct InputToken {
        address token;
        uint256 amount;
    }

    /// @dev tokens that need to be received by the recipient on another chain in order to satisfy an order
    struct OutputToken {
        address token;
        uint256 amount;
    }

    event USSFundsDeposited(
        InputToken inputToken,
        OutputToken outputToken,
        uint256 indexed destinationChainId,
        uint32 indexed depositId,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        address indexed depositor,
        address recipient,
        address relayer,
        bytes message
    );

    event FilledUSSRelay(
        InputToken inputToken,
        OutputToken outputToken,
        uint256 repaymentChainId,
        uint256 indexed originChainId,
        uint32 indexed depositId,
        uint32 fillDeadline,
        address indexed relayer,
        address depositor,
        address recipient,
        bytes message,
        // Parameters with "updated" prefix to signal that these parameters can be updated via speed ups.
        address updatedRecipient,
        bool slowFill,
        uint256 updatedOutputAmount,
        int256 payoutAdjustmentPct,
        bytes updatedMessage
    );

    event ExecutedUSSRelayerRefundRoot(
        uint256 amountToReturn,
        uint256 indexed chainId,
        uint256[] refundAmounts,
        uint32 indexed rootBundleId,
        uint32 indexed leafId,
        address l2TokenAddress,
        address[] refundAddresses,
        bytes32 fillsRefundedRoot,
        string fillsRefundedIpfsHash
    );

    function depositUSS(
        address depositor,
        address recipient,
        // TODO: Running into stack-too-deep errors when emitting FundsDeposited with all of the parameters
        // so I've packed them for now into input and output token structs
        InputToken memory inputToken,
        OutputToken memory outputToken,
        uint256 destinationChainId,
        address exclusiveRelayer,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        bytes memory message
    ) external payable;

    function fillUSSRelay(
        address depositor,
        address recipient,
        address exclusiveRelayer,
        InputToken memory inputToken,
        OutputToken memory outputToken,
        uint256 repaymentChainId,
        uint256 originChainId,
        uint32 depositId,
        uint32 fillDeadline,
        bytes memory message
    ) external;

    function executeUSSRelayerRefundLeaf(
        uint32 rootBundleId,
        USSRelayerRefundLeaf memory relayerRefundLeaf,
        bytes32[] memory proof
    ) external;
}
