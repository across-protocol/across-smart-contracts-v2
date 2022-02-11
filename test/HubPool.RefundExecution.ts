import { toBNWei, SignerWithAddress, seedWallet, expect, Contract, ethers } from "./utils";
import * as consts from "./constants";
import { hubPoolFixture, enableTokensForLP } from "./HubPool.Fixture";
import { buildPoolRebalanceLeafTree, buildPoolRebalanceLeafs } from "./MerkleLib.utils";

let hubPool: Contract, mockAdapter: Contract, weth: Contract, dai: Contract, mockSpoke: Contract, timer: Contract;
let owner: SignerWithAddress, dataWorker: SignerWithAddress, liquidityProvider: SignerWithAddress;
let l2Weth: string, l2Dai: string;

// Construct the leafs that will go into the merkle tree. For this function create a simple set of leafs that will
// repay two token to one chain Id with simple lpFee, netSend and running balance amounts.
async function constructSimpleTree() {
  const wethToSendToL2 = toBNWei(100);
  const daiToSend = toBNWei(1000);
  const leafs = buildPoolRebalanceLeafs(
    [consts.repaymentChainId], // repayment chain. In this test we only want to send one token to one chain.
    [weth, dai], // l1Token. We will only be sending WETH and DAI to the associated repayment chain.
    [[toBNWei(1), toBNWei(10)]], // bundleLpFees. Set to 1 ETH and 10 DAI respectively to attribute to the LPs.
    [[wethToSendToL2, daiToSend]], // netSendAmounts. Set to 100 ETH and 1000 DAI as the amount to send from L1->L2.
    [[wethToSendToL2, daiToSend]] // runningBalances. Set to 100 ETH and 1000 DAI.
  );
  const tree = await buildPoolRebalanceLeafTree(leafs);

  return { wethToSendToL2, daiToSend, leafs, tree };
}

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

    await weth.connect(dataWorker).approve(hubPool.address, consts.bondAmount.mul(10));
  });

  it("Execute relayer refund correctly produces the refund bundle call and sends cross-chain repayment actions", async function () {
    const { wethToSendToL2, daiToSend, leafs, tree } = await constructSimpleTree();

    await hubPool.connect(dataWorker).initiateRelayerRefund(
      [3117], // bundleEvaluationBlockNumbers used by bots to construct bundles. Length must equal the number of leafs.
      1, // poolRebalanceLeafCount. There is exactly one leaf in the bundle (just sending WETH to one address).
      tree.getHexRoot(), // poolRebalanceRoot. Generated from the merkle tree constructed before.
      consts.mockDestinationDistributionRoot, // destinationDistributionRoot. Not relevant for this test.
      consts.mockSlowRelayFulfillmentRoot // Mock root because this isn't relevant for this test.
    );

    // Advance time so the request can be executed and execute the request.
    await timer.setCurrentTime(Number(await timer.getCurrentTime()) + consts.refundProposalLiveness);
    await hubPool.connect(dataWorker).executeRelayerRefund(leafs[0], tree.getHexProof(leafs[0]));

    // Balances should have updated as expected.
    expect(await weth.balanceOf(hubPool.address)).to.equal(consts.amountToLp.sub(wethToSendToL2));
    expect(await weth.balanceOf(mockAdapter.address)).to.equal(wethToSendToL2);
    expect(await dai.balanceOf(hubPool.address)).to.equal(consts.amountToLp.mul(10).sub(daiToSend));
    expect(await dai.balanceOf(mockAdapter.address)).to.equal(daiToSend);

    // Check the mockAdapter was called with the correct arguments for each method.
    const relayMessageEvents = await mockAdapter.queryFilter(mockAdapter.filters.RelayMessageCalled());
    expect(relayMessageEvents.length).to.equal(1); // Exactly one message send from L1->L2.
    expect(relayMessageEvents[0].args?.target).to.equal(mockSpoke.address);
    expect(relayMessageEvents[0].args?.message).to.equal(
      mockSpoke.interface.encodeFunctionData("initializeRelayerRefund", [
        consts.mockDestinationDistributionRoot,
        consts.mockSlowRelayFulfillmentRoot,
      ])
    );

    const relayTokensEvents = await mockAdapter.queryFilter(mockAdapter.filters.RelayTokensCalled());
    expect(relayTokensEvents.length).to.equal(2); // Exactly two token transfers from L1->L2.
    expect(relayTokensEvents[0].args?.l1Token).to.equal(weth.address);
    expect(relayTokensEvents[0].args?.l2Token).to.equal(l2Weth);
    expect(relayTokensEvents[0].args?.amount).to.equal(wethToSendToL2);
    expect(relayTokensEvents[0].args?.to).to.equal(mockSpoke.address);
    expect(relayTokensEvents[1].args?.l1Token).to.equal(dai.address);
    expect(relayTokensEvents[1].args?.l2Token).to.equal(l2Dai);
    expect(relayTokensEvents[1].args?.amount).to.equal(daiToSend);
    expect(relayTokensEvents[1].args?.to).to.equal(mockSpoke.address);

    // Check the leaf count was decremented correctly.
    expect((await hubPool.refundRequest()).unclaimedPoolRebalanceLeafCount).to.equal(0);
  });
  it("Execution rejects leaf claim before liveness passed", async function () {
    const { leafs, tree } = await constructSimpleTree();
    await hubPool
      .connect(dataWorker)
      .initiateRelayerRefund([3117], 1, tree.getHexRoot(), consts.mockTreeRoot, consts.mockSlowRelayFulfillmentRoot);

    // Set time 10 seconds before expiration. Should revert.
    await timer.setCurrentTime(Number(await timer.getCurrentTime()) + consts.refundProposalLiveness - 10);

    await expect(
      hubPool.connect(dataWorker).executeRelayerRefund(leafs[0], tree.getHexProof(leafs[0]))
    ).to.be.revertedWith("Not passed liveness");

    // Set time after expiration. Should no longer revert.
    await timer.setCurrentTime(Number(await timer.getCurrentTime()) + 10);
    await hubPool.connect(dataWorker).executeRelayerRefund(leafs[0], tree.getHexProof(leafs[0]));
  });

  it("Execution rejects invalid leafs", async function () {
    const { leafs, tree } = await constructSimpleTree();
    await hubPool
      .connect(dataWorker)
      .initiateRelayerRefund([3117], 1, tree.getHexRoot(), consts.mockTreeRoot, consts.mockSlowRelayFulfillmentRoot);
    await timer.setCurrentTime(Number(await timer.getCurrentTime()) + consts.refundProposalLiveness);

    // Take the valid root but change some element within it, such as the chainId. This will change the hash of the leaf
    // and as such the contract should reject it for not being included within the merkle tree for the valid proof.
    const badLeaf = { ...leafs[0], chainId: 13371 };
    await expect(
      hubPool.connect(dataWorker).executeRelayerRefund(badLeaf, tree.getHexProof(leafs[0]))
    ).to.be.revertedWith("Bad Proof");
  });

  it("Execution rejects double claimed leafs", async function () {
    const { leafs, tree } = await constructSimpleTree();
    await hubPool
      .connect(dataWorker)
      .initiateRelayerRefund([3117], 1, tree.getHexRoot(), consts.mockTreeRoot, consts.mockSlowRelayFulfillmentRoot);
    await timer.setCurrentTime(Number(await timer.getCurrentTime()) + consts.refundProposalLiveness);

    // First claim should be fine. Second claim should be reverted as you cant double claim a leaf.
    await hubPool.connect(dataWorker).executeRelayerRefund(leafs[0], tree.getHexProof(leafs[0]));
    await expect(
      hubPool.connect(dataWorker).executeRelayerRefund(leafs[0], tree.getHexProof(leafs[0]))
    ).to.be.revertedWith("Already claimed");
  });
});
