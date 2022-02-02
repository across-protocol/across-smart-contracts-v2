import { expect } from "chai";
import { merkleLibFixture } from "./MerkleLib.Fixture";
import { Contract, BigNumber } from "ethers";
import { MerkleTree } from "../utils/MerkleTree";
import { ethers } from "hardhat";
import { randomBigNumber, randomAddress } from "./utils";

interface PoolRebalance {
  leafId: BigNumber;
  chainId: BigNumber;
  tokenAddresses: string[];
  bundleLpFees: BigNumber[];
  netSendAmount: BigNumber[];
  runningBalance: BigNumber[];
}

interface DestinationDistribution {
  leafId: BigNumber;
  chainId: BigNumber;
  amountToReturn: BigNumber;
  l2TokenAddress: string;
  refundAddresses: string[];
  refundAmounts: BigNumber[];
}

let merkleLibTest: Contract;

describe("MerkleLib Proofs", async function () {
  before(async function () {
    ({ merkleLibTest } = await merkleLibFixture());
  });

  it("PoolRebalance Proof", async function () {
    const poolRebalances: PoolRebalance[] = [];
    const numRebalances = 101;
    for (let i = 0; i < numRebalances; i++) {
      const numTokens = 10;
      const tokenAddresses: string[] = [];
      const bundleLpFees: BigNumber[] = [];
      const netSendAmount: BigNumber[] = [];
      const runningBalance: BigNumber[] = [];
      for (let j = 0; j < numTokens; j++) {
        tokenAddresses.push(randomAddress());
        bundleLpFees.push(randomBigNumber());
        netSendAmount.push(randomBigNumber());
        runningBalance.push(randomBigNumber());
      }
      poolRebalances.push({
        leafId: BigNumber.from(i),
        chainId: randomBigNumber(),
        tokenAddresses,
        bundleLpFees,
        netSendAmount,
        runningBalance,
      });
    }

    // Remove the last element.
    const invalidPoolRebalance = poolRebalances.pop()!;

    const fragment = merkleLibTest.interface.fragments.find((fragment) => fragment.name === "verifyPoolRebalance");
    const param = fragment!.inputs.find((input) => input.name === "rebalance");

    const hashFn = (input: PoolRebalance) =>
      ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode([param!], [input]));
    const merkleTree = new MerkleTree<PoolRebalance>(poolRebalances, hashFn);

    const root = merkleTree.getHexRoot();
    const proof = merkleTree.getHexProof(poolRebalances[34]);
    expect(await merkleLibTest.verifyPoolRebalance(root, poolRebalances[34], proof)).to.equal(true);

    // Verify that the excluded element fails to generate a proof and fails verification using the proof generated above.
    expect(() => merkleTree.getHexProof(invalidPoolRebalance)).to.throw();
    expect(await merkleLibTest.verifyPoolRebalance(root, invalidPoolRebalance, proof)).to.equal(false);
  });
  it("DestinationDistributionProof", async function () {
    const destinationDistributions: DestinationDistribution[] = [];
    const numDistributions = 101; // Create 101 and remove the last to use as the "invalid" one.
    for (let i = 0; i < numDistributions; i++) {
      const numAddresses = 10;
      const refundAddresses: string[] = [];
      const refundAmounts: BigNumber[] = [];
      for (let j = 0; j < numAddresses; j++) {
        refundAddresses.push(randomAddress());
        refundAmounts.push(randomBigNumber());
      }
      destinationDistributions.push({
        leafId: BigNumber.from(i),
        chainId: randomBigNumber(),
        amountToReturn: randomBigNumber(),
        l2TokenAddress: randomAddress(),
        refundAddresses,
        refundAmounts,
      });
    }

    // Remove the last element.
    const invalidDestinationDistribution = destinationDistributions.pop()!;

    const fragment = merkleLibTest.interface.fragments.find(
      (fragment) => fragment.name === "verifyRelayerDistribution"
    );
    const param = fragment!.inputs.find((input) => input.name === "distribution");

    const hashFn = (input: DestinationDistribution) =>
      ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode([param!], [input]));
    const merkleTree = new MerkleTree<DestinationDistribution>(destinationDistributions, hashFn);

    const root = merkleTree.getHexRoot();
    const proof = merkleTree.getHexProof(destinationDistributions[14]);
    expect(await merkleLibTest.verifyRelayerDistribution(root, destinationDistributions[14], proof)).to.equal(true);

    // Verify that the excluded element fails to generate a proof and fails verification using the proof generated above.
    expect(() => merkleTree.getHexProof(invalidDestinationDistribution)).to.throw();
    expect(await merkleLibTest.verifyRelayerDistribution(root, invalidDestinationDistribution, proof)).to.equal(false);
  });
});
