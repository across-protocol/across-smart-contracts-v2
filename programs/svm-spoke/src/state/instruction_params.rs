use anchor_lang::prelude::*;

use crate::{RelayerRefundLeaf, V3RelayData, V3SlowFill};

#[account]
#[derive(InitSpace)]
pub struct ExecuteRelayerRefundLeafParams {
    pub root_bundle_id: u32,                    // ID of the root bundle to be used.
    pub relayer_refund_leaf: RelayerRefundLeaf, // Leaf to be verified against the proof and instruct bundle execution.
    #[max_len(0)]
    pub proof: Vec<[u8; 32]>,  // Proof to verify the leaf's inclusion in relayer refund merkle tree.
}

#[account]
#[derive(InitSpace)]
pub struct FillV3RelayParams {
    pub relay_data: V3RelayData,
    pub repayment_chain_id: u64,
    pub repayment_address: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct RequestV3SlowFillParams {
    pub relay_data: V3RelayData,
}

#[account]
#[derive(InitSpace)]
pub struct ExecuteV3SlowRelayLeafParams {
    pub slow_fill_leaf: V3SlowFill,
    pub root_bundle_id: u32,
    #[max_len(0)]
    pub proof: Vec<[u8; 32]>,
}
