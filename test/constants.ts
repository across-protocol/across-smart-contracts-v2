import { toWei, toBN } from "./utils";

export const amountToSeedWallets = toWei("1500");

export const amountToLp = toWei("1000");

export const amountToDeposit = toWei("100");

export const amountToRelay = toWei("25");

export const depositDestinationChainId = 10;

export const depositRelayerFeePct = toWei("0.1");

export const realizedLpFeePct = toWei("0.1");

export const oneHundredPct = toWei("1");

export const totalPostFeesPct = toBN(oneHundredPct).sub(toBN(depositRelayerFeePct).add(realizedLpFeePct));

export const amountToRelayPreFees = toBN(amountToRelay).mul(toBN(oneHundredPct)).div(totalPostFeesPct);

export const originChainId = 666;
export const repaymentChainId = 777;
export const firstDepositId = 0;

export const depositQuoteTimeBuffer = 10 * 60; // 10 minutes

export const bondAmount = toWei("5"); // 5 ETH as the bond for proposing refund bundles.

export const refundProposalLiveness = 100;
