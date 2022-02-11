import {
  sampleL2Gas,
  amountToLp,
  mockTreeRoot,
  refundProposalLiveness,
  bondAmount,
  mockSlowRelayFulfillmentRoot,
} from "./../constants";
import { ethers, expect, Contract, FakeContract, SignerWithAddress, createFake } from "../utils";
import { getContractFactory, seedWallet } from "../utils";
import { hubPoolFixture, enableTokensForLP } from "../HubPool.Fixture";
import { constructSingleChainTree } from "../MerkleLib.utils";

let hubPool: Contract, optimismAdapter: Contract, weth: Contract, dai: Contract, timer: Contract, mockSpoke: Contract;
let l2Weth: string, l2Dai: string;
let owner: SignerWithAddress, dataWorker: SignerWithAddress, liquidityProvider: SignerWithAddress;
let l1CrossDomainMessenger: FakeContract, l1StandardBridge: FakeContract;

const optimismChainId = 10;

describe("Optimism Chain Adapter", function () {
  beforeEach(async function () {
    [owner, dataWorker, liquidityProvider] = await ethers.getSigners();
    ({ weth, dai, l2Weth, l2Dai, hubPool, mockSpoke, timer } = await hubPoolFixture());
    await seedWallet(dataWorker, [dai], weth, amountToLp);
    await seedWallet(liquidityProvider, [dai], weth, amountToLp.mul(10));

    await enableTokensForLP(owner, hubPool, weth, [weth, dai]);
    await weth.connect(liquidityProvider).approve(hubPool.address, amountToLp);
    await hubPool.connect(liquidityProvider).addLiquidity(weth.address, amountToLp);
    await weth.connect(dataWorker).approve(hubPool.address, bondAmount.mul(10));
    await dai.connect(liquidityProvider).approve(hubPool.address, amountToLp);
    await hubPool.connect(liquidityProvider).addLiquidity(dai.address, amountToLp);
    await dai.connect(dataWorker).approve(hubPool.address, bondAmount.mul(10));

    l1StandardBridge = await createFake("L1StandardBridge");
    l1CrossDomainMessenger = await createFake("L1CrossDomainMessenger");

    optimismAdapter = await (
      await getContractFactory("Optimism_Adapter", owner)
    ).deploy(weth.address, hubPool.address, l1CrossDomainMessenger.address, l1StandardBridge.address);

    await hubPool.setCrossChainContracts(optimismChainId, optimismAdapter.address, mockSpoke.address);
    await hubPool.whitelistRoute(optimismChainId, weth.address, l2Weth);
    await hubPool.whitelistRoute(optimismChainId, dai.address, l2Dai);
  });

  it("Only owner can set l2GasValues", async function () {
    expect(await optimismAdapter.callStatic.l2GasLimit()).to.equal(sampleL2Gas);
    await expect(optimismAdapter.connect(liquidityProvider).setL2GasLimit(sampleL2Gas + 1)).to.be.reverted;
    await optimismAdapter.connect(owner).setL2GasLimit(sampleL2Gas + 1);
    expect(await optimismAdapter.callStatic.l2GasLimit()).to.equal(sampleL2Gas + 1);
  });
  it("Correctly calls appropriate Optimism bridge functions when making ERC20 cross chain calls", async function () {
    // Create an action that will send an L1->L2 tokens transfer and bundle. For this, create a relayer repayment bundle
    // and check that at it's finalization the L2 bridge contracts are called as expected.
    const { leafs, tree, tokensSendToL2 } = await constructSingleChainTree(dai, 1, optimismChainId);
    await hubPool
      .connect(dataWorker)
      .initiateRelayerRefund([3117], 1, tree.getHexRoot(), mockTreeRoot, mockSlowRelayFulfillmentRoot);
    await timer.setCurrentTime(Number(await timer.getCurrentTime()) + refundProposalLiveness);
    await hubPool.connect(dataWorker).executeRelayerRefund(leafs[0], tree.getHexProof(leafs[0]));

    // The correct functions should have been called on the optimism contracts.
    expect(l1StandardBridge.depositERC20To).to.have.been.calledOnce; // One token transfer over the bridge.
    expect(l1StandardBridge.depositETHTo).to.have.callCount(0); // No ETH transfers over the bridge.
    const expectedErc20L1ToL2BridgeParams = [dai.address, l2Dai, mockSpoke.address, tokensSendToL2, sampleL2Gas, "0x"];
    expect(l1StandardBridge.depositERC20To).to.have.been.calledWith(...expectedErc20L1ToL2BridgeParams);
    const expectedL2ToL1FunctionCallParams = [
      mockSpoke.address,
      mockSpoke.interface.encodeFunctionData("initializeRelayerRefund", [mockTreeRoot, mockSlowRelayFulfillmentRoot]),
      sampleL2Gas,
    ];
    expect(l1CrossDomainMessenger.sendMessage).to.have.been.calledWith(...expectedL2ToL1FunctionCallParams);
  });
  it("Correctly unwraps WETH and bridges ETH", async function () {
    // Cant bridge WETH on optimism. Rather, unwrap WETH to ETH then bridge it. Validate the adapter does this.
    const { leafs, tree } = await constructSingleChainTree(weth, 1, optimismChainId);
    await hubPool
      .connect(dataWorker)
      .initiateRelayerRefund([3117], 1, tree.getHexRoot(), mockTreeRoot, mockSlowRelayFulfillmentRoot);
    await timer.setCurrentTime(Number(await timer.getCurrentTime()) + refundProposalLiveness);
    await hubPool.connect(dataWorker).executeRelayerRefund(leafs[0], tree.getHexProof(leafs[0]));

    // The correct functions should have been called on the optimism contracts.
    expect(l1StandardBridge.depositETHTo).to.have.been.calledOnce; // One eth transfer over the bridge.
    expect(l1StandardBridge.depositERC20To).to.have.callCount(0); // No Token transfers over the bridge.
    expect(l1StandardBridge.depositETHTo).to.have.been.calledWith(mockSpoke.address, sampleL2Gas, "0x");
    const expectedL2ToL1FunctionCallParams = [
      mockSpoke.address,
      mockSpoke.interface.encodeFunctionData("initializeRelayerRefund", [mockTreeRoot, mockSlowRelayFulfillmentRoot]),
      sampleL2Gas,
    ];
    expect(l1CrossDomainMessenger.sendMessage).to.have.been.calledWith(...expectedL2ToL1FunctionCallParams);
  });
});
