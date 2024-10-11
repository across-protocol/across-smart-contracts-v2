// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import { Test } from "forge-std/Test.sol";

import { V3SpokePoolInterface } from "../../../../contracts/interfaces/V3SpokePoolInterface.sol";

contract RelayHashFuzzTest is Test {
    // The number of times to derive a new relay hash in a single forge test. For example, if foundry runs `testFuzzRelayHash` 256 times, then
    // 256 * NUM_RERANDOMIZES different hashes are checked in this test in total.
    uint256 private constant NUM_RERANDOMIZES = 30;

    // Original V3 RelayData struct used to derive a relayHash.
    // A relay hash is defined as the keccak256 hash of the abi encoded struct.
    struct LegacyV3RelayData {
        address depositor;
        address recipient;
        address exclusiveRelayer;
        address inputToken;
        address outputToken;
        uint256 inputAmount;
        uint256 outputAmount;
        uint256 originChainId;
        uint32 depositId;
        uint32 fillDeadline;
        uint32 exclusivityDeadline;
        bytes message;
    }

    function setUp() public {}

    function testFuzzRelayHash(LegacyV3RelayData memory relayData) public {
        for (uint256 _i = 0; _i < NUM_RERANDOMIZES; ++_i) {
            _compareHashes(relayData);
            relayData = _rerandomize(relayData);
        }
    }

    // This is a check to ensure that the relay hash will not change when swapping the deposit ID from a uint32 to a uint256.
    function _compareHashes(LegacyV3RelayData memory relayData) private view {
        bytes memory legacyData = abi.encode(relayData, block.chainid);
        bytes memory newData = abi.encode(
            V3SpokePoolInterface.V3RelayData({
                depositor: relayData.depositor,
                recipient: relayData.recipient,
                exclusiveRelayer: relayData.exclusiveRelayer,
                inputToken: relayData.inputToken,
                outputToken: relayData.outputToken,
                inputAmount: relayData.inputAmount,
                outputAmount: relayData.outputAmount,
                originChainId: relayData.originChainId,
                depositId: uint256(relayData.depositId),
                fillDeadline: relayData.fillDeadline,
                exclusivityDeadline: relayData.exclusivityDeadline,
                message: relayData.message
            }),
            block.chainid
        );
        // If the encoded data is equal, then the hashes will be equal.
        assertEq(legacyData, newData);
    }

    // Basic rerandomization by hashing fields and casting them to their appropriate types.
    function _rerandomize(LegacyV3RelayData memory relayData) private returns (LegacyV3RelayData memory) {
        return
            LegacyV3RelayData({
                depositor: address(uint160(_rerandomizeField(abi.encode(relayData.depositor)))),
                recipient: address(uint160(_rerandomizeField(abi.encode(relayData.recipient)))),
                exclusiveRelayer: address(uint160(_rerandomizeField(abi.encode(relayData.exclusiveRelayer)))),
                inputToken: address(uint160(_rerandomizeField(abi.encode(relayData.inputToken)))),
                outputToken: address(uint160(_rerandomizeField(abi.encode(relayData.outputToken)))),
                inputAmount: _rerandomizeField(abi.encode(relayData.inputAmount)),
                outputAmount: _rerandomizeField(abi.encode(relayData.outputAmount)),
                originChainId: _rerandomizeField(abi.encode(relayData.originChainId)),
                depositId: uint32(_rerandomizeField(abi.encode(uint256(relayData.depositId)))),
                fillDeadline: uint32(_rerandomizeField(abi.encode(relayData.fillDeadline))),
                exclusivityDeadline: uint32(_rerandomizeField(abi.encode(relayData.exclusivityDeadline))),
                message: abi.encode(relayData)
            });
    }

    function _rerandomizeField(bytes memory data) private returns (uint256) {
        return uint256(keccak256(data));
    }
}
