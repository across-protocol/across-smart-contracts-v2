import { expect } from "chai";
import { Contract } from "ethers";
import { ethers } from "hardhat";

import { SignerWithAddress, toBNWei, seedWallet } from "./utils";
import * as consts from "./constants";
import { hubPoolFixture, enableTokensForLP } from "./HubPool.Fixture";
import { buildPoolRebalanceTree, buildPoolRebalanceLeafs } from "./MerkleLib.utils";

let hubPool: Contract, mockAdapter: Contract, weth: Contract, dai: Contract, mockSpoke: Contract, timer: Contract;
let owner: SignerWithAddress, dataWorker: SignerWithAddress, liquidityProvider: SignerWithAddress;
let l2Weth: string, l2Dai: string;

describe("HubPool Relayer Refund Execution", function () {
  beforeEach(async function () {
    [owner, dataWorker, liquidityProvider] = await ethers.getSigners();
    ({ weth, dai, hubPool, mockAdapter, mockSpoke, timer, l2Weth, l2Dai } = await hubPoolFixture());
    await seedWallet(dataWorker, [dai], weth, consts.bondAmount.add(consts.finalFee).mul(2));
    await seedWallet(liquidityProvider, [dai], weth, consts.amountToLp.mul(10));

    await enableTokensForLP(owner, hubPool, weth, [weth, dai]);
    await weth.connect(liquidityProvider).approve(hubPool.address, consts.amountToLp);
    await hubPool.connect(liquidityProvider).addLiquidity(weth.address, consts.amountToLp);
    await dai.connect(liquidityProvider).approve(hubPool.address, consts.amountToLp.mul(10)); // LP with 10000 DAI.
    await hubPool.connect(liquidityProvider).addLiquidity(dai.address, consts.amountToLp.mul(10));
  });

  it("Execute relayer refund correctly produces the refund bundle call and sends cross-chain repayment actions", async function () {
    await weth.connect(dataWorker).approve(hubPool.address, consts.bondAmount.mul(10));

    // Construct the leafs that will go into the merkle tree. For this test create a simple set of leafs that will repay
    // two token to one chain Id with simple lpFee, netSend and running balance amounts.
    const wethToSend = toBNWei(100);
    const daiToSend = toBNWei(1000);
    const leafs = buildPoolRebalanceLeafs(
      [consts.repaymentChainId], // repayment chain. In this test we only want to send one token to one chain.
      [weth, dai], // l1Token. We will only be sending WETH and DAI to the associated repayment chain.
      [[toBNWei(1), toBNWei(10)]], // bundleLpFees. Set to 1 ETH and 10 DAI respectively to attribute to the LPs.
      [[wethToSend, daiToSend]], // netSendAmounts. Set to 100 ETH and 1000 DAI as the amount to send from L1->L2.
      [[wethToSend, daiToSend]] // runningBalances. Set to 100 ETH and 1000 DAI.
    );

    const poolRebalanceTree = await buildPoolRebalanceTree(leafs);

    await hubPool.connect(dataWorker).initiateRelayerRefund(
      [3117], // bundleEvaluationBlockNumbers used by bots to construct bundles. Length must equal the number of leafs.
      1, // poolRebalanceLeafCount. There is exactly one leaf in the bundle (just sending WETH to one address).
      poolRebalanceTree.getHexRoot(), // poolRebalanceRoot. Generated from the merkle tree constructed before.
      consts.mockDestinationDistributionRoot // destinationDistributionRoot. Not relevant for this test.
    );

    // Advance time so the request can be executed and execute the request.
    await timer.setCurrentTime(Number(await timer.getCurrentTime()) + consts.refundProposalLiveness);
    await hubPool.connect(dataWorker).executeRelayerRefund(0, leafs[0], poolRebalanceTree.getHexProof(leafs[0]));

    // Balances should have updated as expected.
    expect(await weth.balanceOf(hubPool.address)).to.equal(consts.amountToLp.sub(wethToSend));
    expect(await weth.balanceOf(mockAdapter.address)).to.equal(wethToSend);
    expect(await dai.balanceOf(hubPool.address)).to.equal(consts.amountToLp.mul(10).sub(daiToSend));
    expect(await dai.balanceOf(mockAdapter.address)).to.equal(daiToSend);

    // Check the mockAdapter was called with the correct arguments for each method.
    const relayMessageEvents = await mockAdapter.queryFilter(mockAdapter.filters.RelayMessageCalled());
    expect(relayMessageEvents.length).to.equal(1); // Exactly one message send from L1->L2.
    expect(relayMessageEvents[0].args?.target).to.equal(mockSpoke.address);
    expect(relayMessageEvents[0].args?.message).to.equal(
      mockSpoke.interface.encodeFunctionData("initializeRelayerRefund", [consts.mockDestinationDistributionRoot])
    );

    const relayTokensEvents = await mockAdapter.queryFilter(mockAdapter.filters.RelayTokensCalled());
    expect(relayTokensEvents.length).to.equal(2); // Exactly two token transfers from L1->L2.
    expect(relayTokensEvents[0].args?.l1Token).to.equal(weth.address);
    expect(relayTokensEvents[0].args?.l2Token).to.equal(l2Weth);
    expect(relayTokensEvents[0].args?.amount).to.equal(wethToSend);
    expect(relayTokensEvents[0].args?.to).to.equal(mockSpoke.address);
    expect(relayTokensEvents[1].args?.l1Token).to.equal(dai.address);
    expect(relayTokensEvents[1].args?.l2Token).to.equal(l2Dai);
    expect(relayTokensEvents[1].args?.amount).to.equal(daiToSend);
    expect(relayTokensEvents[1].args?.to).to.equal(mockSpoke.address);
  });
});
