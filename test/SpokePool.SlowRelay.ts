import {
  expect,
  Contract,
  ethers,
  SignerWithAddress,
  seedWallet,
  toBN,
  randomAddress,
  randomBigNumber,
  BigNumber,
} from "./utils";
import { spokePoolFixture, enableRoutes, getExecuteSlowRelayParams, SlowFill } from "./fixtures/SpokePool.Fixture";
import { getFillRelayParams, getRelayHash } from "./fixtures/SpokePool.Fixture";
import { MerkleTree } from "../utils/MerkleTree";
import { buildSlowRelayTree } from "./MerkleLib.utils";
import * as consts from "./constants";

let spokePool: Contract, weth: Contract, erc20: Contract, destErc20: Contract;
let depositor: SignerWithAddress, recipient: SignerWithAddress, relayer: SignerWithAddress;
let slowFills: SlowFill[];
let tree: MerkleTree<SlowFill>;

const OTHER_DESTINATION_CHAIN_ID = (consts.destinationChainId + 666).toString();
const ZERO = BigNumber.from(0);

// Relay fees for slow relay are only the realizedLpFee; the depositor should be re-funded the relayer fee
// for any amount sent by a slow relay.
const fullRelayAmountPostFees = consts.amountToRelay
  .mul(toBN(consts.oneHundredPct).sub(consts.realizedLpFeePct))
  .div(toBN(consts.oneHundredPct));

describe("SpokePool Slow Relay Logic", async function () {
  beforeEach(async function () {
    [depositor, recipient, relayer] = await ethers.getSigners();
    ({ weth, erc20, spokePool, destErc20 } = await spokePoolFixture());

    // mint some fresh tokens and deposit ETH for weth for depositor and relayer.
    await seedWallet(depositor, [erc20], weth, consts.amountToSeedWallets);
    await seedWallet(depositor, [destErc20], weth, consts.amountToSeedWallets);
    await seedWallet(relayer, [erc20], weth, consts.amountToSeedWallets);
    await seedWallet(relayer, [destErc20], weth, consts.amountToSeedWallets);

    // Send tokens to the spoke pool for repayment.
    await destErc20.connect(depositor).transfer(spokePool.address, fullRelayAmountPostFees);
    await weth.connect(depositor).transfer(spokePool.address, fullRelayAmountPostFees);

    // Approve spoke pool to take relayer's tokens.
    await destErc20.connect(relayer).approve(spokePool.address, fullRelayAmountPostFees);
    await weth.connect(relayer).approve(spokePool.address, fullRelayAmountPostFees);

    // Whitelist origin token => destination chain ID routes:
    await enableRoutes(spokePool, [{ originToken: erc20.address }, { originToken: weth.address }]);

    slowFills = [];
    for (let i = 0; i < 99; i++) {
      // Relay for different destination chain
      slowFills.push({
        relayData: {
          depositor: randomAddress(),
          recipient: randomAddress(),
          destinationToken: randomAddress(),
          amount: randomBigNumber(),
          originChainId: randomBigNumber(2).toString(),
          destinationChainId: OTHER_DESTINATION_CHAIN_ID,
          realizedLpFeePct: randomBigNumber(8, true),
          relayerFeePct: randomBigNumber(8, true),
          depositId: randomBigNumber(2).toString(),
        },
        payoutAdjustment: "0",
      });
    }

    // ERC20
    slowFills.push({
      relayData: {
        depositor: depositor.address,
        recipient: recipient.address,
        destinationToken: destErc20.address,
        amount: consts.amountToRelay,
        originChainId: consts.originChainId.toString(),
        destinationChainId: consts.destinationChainId.toString(),
        realizedLpFeePct: consts.realizedLpFeePct,
        relayerFeePct: consts.depositRelayerFeePct,
        depositId: consts.firstDepositId.toString(),
      },
      payoutAdjustment: "0",
    });

    // WETH
    slowFills.push({
      relayData: {
        depositor: depositor.address,
        recipient: recipient.address,
        destinationToken: weth.address,
        amount: consts.amountToRelay,
        originChainId: consts.originChainId.toString(),
        destinationChainId: consts.destinationChainId.toString(),
        realizedLpFeePct: consts.realizedLpFeePct,
        relayerFeePct: consts.depositRelayerFeePct,
        depositId: consts.firstDepositId.toString(),
      },
      payoutAdjustment: "0",
    });

    tree = await buildSlowRelayTree(slowFills);

    await spokePool.connect(depositor).relayRootBundle(consts.mockTreeRoot, tree.getHexRoot());
  });
  it("Simple SlowRelay ERC20 balances", async function () {
    await expect(() =>
      spokePool
        .connect(relayer)
        .executeSlowRelayLeaf(
          ...getExecuteSlowRelayParams(
            depositor.address,
            recipient.address,
            destErc20.address,
            consts.amountToRelay,
            consts.originChainId,
            consts.realizedLpFeePct,
            consts.depositRelayerFeePct,
            consts.firstDepositId,
            0,
            ZERO,
            tree.getHexProof(slowFills.find((slowFill) => slowFill.relayData.destinationToken === destErc20.address)!)
          )
        )
    ).to.changeTokenBalances(
      destErc20,
      [spokePool, recipient],
      [fullRelayAmountPostFees.mul(-1), fullRelayAmountPostFees]
    );
  });

  it("Simple SlowRelay ERC20 FilledRelay event", async function () {
    slowFills.find((slowFill) => slowFill.relayData.destinationToken === destErc20.address)!;

    await expect(
      spokePool
        .connect(relayer)
        .executeSlowRelayLeaf(
          ...getExecuteSlowRelayParams(
            depositor.address,
            recipient.address,
            destErc20.address,
            consts.amountToRelay,
            consts.originChainId,
            consts.realizedLpFeePct,
            consts.depositRelayerFeePct,
            consts.firstDepositId,
            0,
            ZERO,
            tree.getHexProof(slowFills.find((slowFill) => slowFill.relayData.destinationToken === destErc20.address)!)
          )
        )
    )
      .to.emit(spokePool, "FilledRelay")
      .withArgs(
        consts.amountToRelay,
        consts.amountToRelay,
        consts.amountToRelay,
        0, // Repayment chain ID should always be 0 for slow relay fills.
        consts.originChainId,
        consts.destinationChainId,
        consts.depositRelayerFeePct,
        0, // Should not have an applied relayerFeePct for slow relay fills.
        consts.realizedLpFeePct,
        consts.firstDepositId,
        destErc20.address,
        relayer.address,
        depositor.address,
        recipient.address,
        true
      );
  });

  it("Simple SlowRelay WETH balance", async function () {
    await expect(() =>
      spokePool
        .connect(relayer)
        .executeSlowRelayLeaf(
          ...getExecuteSlowRelayParams(
            depositor.address,
            recipient.address,
            weth.address,
            consts.amountToRelay,
            consts.originChainId,
            consts.realizedLpFeePct,
            consts.depositRelayerFeePct,
            consts.firstDepositId,
            0,
            ZERO,
            tree.getHexProof(slowFills.find((slowFill) => slowFill.relayData.destinationToken === weth.address)!)
          )
        )
    ).to.changeTokenBalances(weth, [spokePool], [fullRelayAmountPostFees.mul(-1)]);
  });

  it("Simple SlowRelay ETH balance", async function () {
    await expect(() =>
      spokePool
        .connect(relayer)
        .executeSlowRelayLeaf(
          ...getExecuteSlowRelayParams(
            depositor.address,
            recipient.address,
            weth.address,
            consts.amountToRelay,
            consts.originChainId,
            consts.realizedLpFeePct,
            consts.depositRelayerFeePct,
            consts.firstDepositId,
            0,
            ZERO,
            tree.getHexProof(slowFills.find((slowFill) => slowFill.relayData.destinationToken === weth.address)!)
          )
        )
    ).to.changeEtherBalance(recipient, fullRelayAmountPostFees);
  });

  it("Partial SlowRelay ERC20 balances", async function () {
    // Work out a partial amount to fill normally. This should be 1/4 of the total amount post fees, minus
    // the associated deposit relayer fee that is allocated to the fast relayer.
    const partialAmountPostFees = fullRelayAmountPostFees
      .mul(toBN(consts.oneHundredPct).sub(consts.depositRelayerFeePct).div(consts.oneHundredPct))
      .div(4);
    const leftoverPostFees = fullRelayAmountPostFees.sub(partialAmountPostFees);

    await spokePool
      .connect(relayer)
      .fillRelay(
        ...getFillRelayParams(
          getRelayHash(
            depositor.address,
            recipient.address,
            consts.firstDepositId,
            consts.originChainId,
            consts.destinationChainId,
            destErc20.address,
            consts.amountToRelay
          ).relayData,
          partialAmountPostFees
        )
      );
    await expect(() =>
      spokePool
        .connect(relayer)
        .executeSlowRelayLeaf(
          ...getExecuteSlowRelayParams(
            depositor.address,
            recipient.address,
            destErc20.address,
            consts.amountToRelay,
            consts.originChainId,
            consts.realizedLpFeePct,
            consts.depositRelayerFeePct,
            consts.firstDepositId,
            0,
            ZERO,
            tree.getHexProof(slowFills.find((slowFill) => slowFill.relayData.destinationToken === destErc20.address)!)
          )
        )
    ).to.changeTokenBalances(destErc20, [spokePool, recipient], [leftoverPostFees.mul(-1), leftoverPostFees]);
  });

  it("Partial SlowRelay WETH balance", async function () {
    const partialAmountPostFees = fullRelayAmountPostFees
      .mul(toBN(consts.oneHundredPct).sub(consts.depositRelayerFeePct).div(consts.oneHundredPct))
      .div(4);
    const leftoverPostFees = fullRelayAmountPostFees.sub(partialAmountPostFees);

    await spokePool
      .connect(relayer)
      .fillRelay(
        ...getFillRelayParams(
          getRelayHash(
            depositor.address,
            recipient.address,
            consts.firstDepositId,
            consts.originChainId,
            consts.destinationChainId,
            weth.address,
            consts.amountToRelay
          ).relayData,
          partialAmountPostFees
        )
      );

    await expect(() =>
      spokePool
        .connect(relayer)
        .executeSlowRelayLeaf(
          ...getExecuteSlowRelayParams(
            depositor.address,
            recipient.address,
            weth.address,
            consts.amountToRelay,
            consts.originChainId,
            consts.realizedLpFeePct,
            consts.depositRelayerFeePct,
            consts.firstDepositId,
            0,
            ZERO,
            tree.getHexProof(slowFills.find((slowFill) => slowFill.relayData.destinationToken === weth.address)!)
          )
        )
    ).to.changeTokenBalances(weth, [spokePool], [leftoverPostFees.mul(-1)]);
  });

  it("Partial SlowRelay ETH balance", async function () {
    const partialAmountPostFees = fullRelayAmountPostFees
      .mul(toBN(consts.oneHundredPct).sub(consts.depositRelayerFeePct).div(consts.oneHundredPct))
      .div(4);
    const leftoverPostFees = fullRelayAmountPostFees.sub(partialAmountPostFees);

    await spokePool
      .connect(relayer)
      .fillRelay(
        ...getFillRelayParams(
          getRelayHash(
            depositor.address,
            recipient.address,
            consts.firstDepositId,
            consts.originChainId,
            consts.destinationChainId,
            weth.address,
            consts.amountToRelay
          ).relayData,
          partialAmountPostFees
        )
      );

    await expect(() =>
      spokePool
        .connect(relayer)
        .executeSlowRelayLeaf(
          ...getExecuteSlowRelayParams(
            depositor.address,
            recipient.address,
            weth.address,
            consts.amountToRelay,
            consts.originChainId,
            consts.realizedLpFeePct,
            consts.depositRelayerFeePct,
            consts.firstDepositId,
            0,
            ZERO,
            tree.getHexProof(slowFills.find((slowFill) => slowFill.relayData.destinationToken === weth.address)!)
          )
        )
    ).to.changeEtherBalance(recipient, leftoverPostFees);
  });

  it("Bad proof: Relay data is correct except that destination chain ID doesn't match spoke pool's", async function () {
    const slowFill = slowFills.find((fill) => fill.relayData.destinationChainId === OTHER_DESTINATION_CHAIN_ID)!;

    // This should revert because the relay struct that we found via .find() is the one inserted in the merkle root
    // published to the spoke pool, but its destination chain ID is OTHER_DESTINATION_CHAIN_ID, which is different
    // than the spoke pool's destination chain ID.
    await expect(
      spokePool
        .connect(relayer)
        .executeSlowRelayLeaf(
          ...getExecuteSlowRelayParams(
            slowFill.relayData.depositor,
            slowFill.relayData.recipient,
            slowFill.relayData.destinationToken,
            toBN(slowFill.relayData.amount),
            Number(slowFill.relayData.originChainId),
            toBN(slowFill.relayData.realizedLpFeePct),
            toBN(slowFill.relayData.relayerFeePct),
            Number(slowFill.relayData.depositId),
            0,
            ZERO,
            tree.getHexProof(slowFill!)
          )
        )
    ).to.be.revertedWith("Invalid proof");
  });

  it("Bad proof: Relay data besides destination chain ID is not included in merkle root", async function () {
    await expect(
      spokePool.connect(relayer).executeSlowRelayLeaf(
        ...getExecuteSlowRelayParams(
          depositor.address,
          recipient.address,
          weth.address,
          consts.amountToRelay.sub(1), // Slightly modify the relay data from the expected set.
          consts.originChainId,
          consts.realizedLpFeePct,
          consts.depositRelayerFeePct,
          consts.firstDepositId,
          0,
          ZERO,
          tree.getHexProof(slowFills.find((slowFill) => slowFill.relayData.destinationToken === weth.address)!)
        )
      )
    ).to.be.reverted;
  });
});
