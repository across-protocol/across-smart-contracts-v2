use anchor_lang::prelude::*;

declare_id!("E5USYAs9DUzn6ykrWZXuEkbCnY3kzNMPGNFH2okvUvqe");

// External programs from idls directory (requires `anchor run generateExternalTypes`).
declare_program!(message_transmitter);
declare_program!(token_messenger_minter);

pub mod constants;
mod constraints;
pub mod error;
mod instructions;
mod state;
pub mod utils;

use instructions::*;
use state::*;

#[program]
pub mod svm_spoke {
    use super::*;

    // Admin methods.
    pub fn initialize(
        ctx: Context<Initialize>,
        seed: u64,
        initial_number_of_deposits: u64,
        chain_id: u64,
        remote_domain: u32,
        cross_domain_admin: Pubkey,
        testable_mode: bool,
    ) -> Result<()> {
        instructions::initialize(
            ctx,
            seed,
            initial_number_of_deposits,
            chain_id,
            remote_domain,
            cross_domain_admin,
            testable_mode,
        )
    }

    pub fn set_current_time(ctx: Context<SetCurrentTime>, new_time: u32) -> Result<()> {
        instructions::set_current_time(ctx, new_time)
    }

    pub fn pause_deposits(ctx: Context<PauseDeposits>, pause: bool) -> Result<()> {
        instructions::pause_deposits(ctx, pause)
    }

    pub fn relay_root_bundle(
        ctx: Context<RelayRootBundle>,
        relayer_refund_root: [u8; 32],
        slow_relay_root: [u8; 32],
    ) -> Result<()> {
        instructions::relay_root_bundle(ctx, relayer_refund_root, slow_relay_root)
    }

    pub fn execute_relayer_refund_leaf<'info>(
        ctx: Context<'_, '_, '_, 'info, ExecuteRelayerRefundLeaf<'info>>,
        root_bundle_id: u32,
        relayer_refund_leaf: RelayerRefundLeaf,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::execute_relayer_refund_leaf(ctx, root_bundle_id, relayer_refund_leaf, proof)
    }

    pub fn pause_fills(ctx: Context<PauseFills>, pause: bool) -> Result<()> {
        instructions::pause_fills(ctx, pause)
    }

    pub fn transfer_ownership(ctx: Context<TransferOwnership>, new_owner: Pubkey) -> Result<()> {
        instructions::transfer_ownership(ctx, new_owner)
    }

    pub fn set_enable_route(
        ctx: Context<SetEnableRoute>,
        origin_token: [u8; 32],
        destination_chain_id: u64,
        enabled: bool,
    ) -> Result<()> {
        instructions::set_enable_route(ctx, origin_token, destination_chain_id, enabled)
    }

    pub fn set_cross_domain_admin(
        ctx: Context<SetCrossDomainAdmin>,
        cross_domain_admin: Pubkey,
    ) -> Result<()> {
        instructions::set_cross_domain_admin(ctx, cross_domain_admin)
    }

    // User methods.
    pub fn deposit_v3(
        ctx: Context<DepositV3>,
        depositor: Pubkey,
        recipient: Pubkey,
        input_token: Pubkey,
        output_token: Pubkey,
        input_amount: u64,
        output_amount: u64,
        destination_chain_id: u64,
        exclusive_relayer: Pubkey,
        quote_timestamp: u32,
        fill_deadline: u32,
        exclusivity_deadline: u32,
        message: Vec<u8>,
    ) -> Result<()> {
        instructions::deposit_v3(
            ctx,
            depositor,
            recipient,
            input_token,
            output_token,
            input_amount,
            output_amount,
            destination_chain_id,
            exclusive_relayer,
            quote_timestamp,
            fill_deadline,
            exclusivity_deadline,
            message,
        )
    }

    // Relayer methods.
    pub fn fill_v3_relay(
        ctx: Context<FillV3Relay>,
        relay_hash: [u8; 32],
        relay_data: V3RelayData,
        repayment_chain_id: u64,
    ) -> Result<()> {
        instructions::fill_v3_relay(ctx, relay_hash, relay_data, repayment_chain_id)
    }

    pub fn close_fill_pda(
        ctx: Context<CloseFillPda>,
        relay_hash: [u8; 32],
        relay_data: V3RelayData,
    ) -> Result<()> {
        instructions::close_fill_pda(ctx, relay_hash, relay_data)
    }

    // CCTP methods.
    pub fn handle_receive_message<'info>(
        ctx: Context<'_, '_, '_, 'info, HandleReceiveMessage<'info>>,
        params: HandleReceiveMessageParams,
    ) -> Result<()> {
        let self_ix_data = ctx.accounts.handle_receive_message(&params)?;

        invoke_self(&ctx, &self_ix_data)?;

        Ok(())
    }

    // Slow fill methods.
    pub fn request_v3_slow_fill(
        ctx: Context<SlowFillV3Relay>,
        relay_hash: [u8; 32],
        relay_data: V3RelayData,
    ) -> Result<()> {
        instructions::request_v3_slow_fill(ctx, relay_hash, relay_data)
    }

    pub fn execute_v3_slow_relay_leaf(
        ctx: Context<ExecuteV3SlowRelayLeaf>,
        relay_hash: [u8; 32],
        slow_fill_leaf: V3SlowFill,
        root_bundle_id: u32,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::execute_v3_slow_relay_leaf(
            ctx,
            relay_hash,
            slow_fill_leaf,
            root_bundle_id,
            proof,
        )
    }
    pub fn bridge_tokens_to_hub_pool(
        ctx: Context<BridgeTokensToHubPool>,
        amount: u64,
    ) -> Result<()> {
        ctx.accounts.bridge_tokens_to_hub_pool(amount, &ctx.bumps)?;

        Ok(())
    }
}
