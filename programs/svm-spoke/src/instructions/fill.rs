use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    common::V3RelayData,
    constants::DISCRIMINATOR_SIZE,
    constraints::is_relay_hash_valid,
    error::{CommonError, SvmError},
    event::{FillType, FilledV3Relay, V3RelayExecutionEventInfo},
    get_current_time,
    state::{FillStatus, FillStatusAccount, FillV3RelayParams, State},
    utils::{hash_non_empty_message, invoke_handler, transfer_from},
};

#[event_cpi]
#[derive(Accounts)]
pub struct FillV3Relay<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    // TODO: consider if it is acceptable to share the same seed for all instructions.
    #[account(seeds = [b"instruction_params", signer.key().as_ref()], bump)]
    pub instruction_params: Account<'info, FillV3RelayParams>,

    #[account(
        seeds = [b"state", state.seed.to_le_bytes().as_ref()],
        bump,
        constraint = !state.paused_fills @ CommonError::FillsArePaused
    )]
    pub state: Account<'info, State>,

    #[account(
        mint::token_program = token_program,
        address = instruction_params.relay_data.output_token @ SvmError::InvalidMint
    )]
    pub mint_account: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint_account,
        token::authority = signer,
        token::token_program = token_program
    )]
    pub relayer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_account,
        associated_token::authority = instruction_params.relay_data.recipient,
        associated_token::token_program = token_program
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = signer,
        space = DISCRIMINATOR_SIZE + FillStatusAccount::INIT_SPACE,
        seeds = [b"fills", instruction_params.relay_hash.as_ref()], // TODO: can we calculate the relay_hash from the state and relay_data?
        bump,
        // Make sure caller provided relay_hash used in PDA seeds is valid.
        constraint = is_relay_hash_valid(
            &instruction_params.relay_hash,
            &instruction_params.relay_data,
            &state
        ) @ SvmError::InvalidRelayHash
    )]
    pub fill_status: Account<'info, FillStatusAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn fill_v3_relay<'info>(ctx: Context<'_, '_, '_, 'info, FillV3Relay<'info>>) -> Result<()> {
    // Get pre-loaded instruction parameters.
    let instruction_params = &ctx.accounts.instruction_params;
    let relay_data = instruction_params.relay_data.to_owned();
    let repayment_chain_id = instruction_params.repayment_chain_id;
    let repayment_address = instruction_params.repayment_address;

    let state = &ctx.accounts.state;
    let current_time = get_current_time(state)?;

    // Check if the exclusivity deadline has passed or if the caller is the exclusive relayer
    if relay_data.exclusive_relayer != ctx.accounts.signer.key()
        && relay_data.exclusivity_deadline >= current_time
        && relay_data.exclusive_relayer != Pubkey::default()
    {
        return err!(CommonError::NotExclusiveRelayer);
    }

    // Check if the fill deadline has passed
    if relay_data.fill_deadline < current_time {
        return err!(CommonError::ExpiredFillDeadline);
    }

    // Check the fill status and set the fill type
    let fill_status_account = &mut ctx.accounts.fill_status;
    let fill_type = match fill_status_account.status {
        FillStatus::Filled => {
            return err!(CommonError::RelayFilled);
        }
        FillStatus::RequestedSlowFill => FillType::ReplacedSlowFill,
        _ => FillType::FastFill,
    };

    // If relayer and receiver are the same, there is no need to do the transfer. This might be a case when relayers
    // intentionally self-relay in a capital efficient way (no need to have funds on the destination).
    if ctx.accounts.relayer_token_account.key() != ctx.accounts.recipient_token_account.key() {
        // Relayer must have delegated output_amount to the state PDA (but only if not self-relaying)
        transfer_from(
            &ctx.accounts.relayer_token_account,
            &ctx.accounts.recipient_token_account,
            relay_data.output_amount,
            state,
            ctx.bumps.state,
            &ctx.accounts.mint_account,
            &ctx.accounts.token_program,
        )?;
    }

    // Update the fill status to Filled and set the relayer
    fill_status_account.status = FillStatus::Filled;
    fill_status_account.relayer = *ctx.accounts.signer.key;

    if relay_data.message.len() > 0 {
        invoke_handler(
            ctx.accounts.signer.as_ref(),
            ctx.remaining_accounts,
            &relay_data.message,
        )?;
    }

    // Emit the FilledV3Relay event
    // Empty message is not hashed and emits zeroed bytes32 for easier human observability.
    let message_hash = hash_non_empty_message(&relay_data.message);

    emit_cpi!(FilledV3Relay {
        input_token: relay_data.input_token,
        output_token: relay_data.output_token,
        input_amount: relay_data.input_amount,
        output_amount: relay_data.output_amount,
        repayment_chain_id,
        origin_chain_id: relay_data.origin_chain_id,
        deposit_id: relay_data.deposit_id,
        fill_deadline: relay_data.fill_deadline,
        exclusivity_deadline: relay_data.exclusivity_deadline,
        exclusive_relayer: relay_data.exclusive_relayer,
        relayer: repayment_address,
        depositor: relay_data.depositor,
        recipient: relay_data.recipient,
        message_hash,
        relay_execution_info: V3RelayExecutionEventInfo {
            updated_recipient: relay_data.recipient,
            updated_message_hash: message_hash,
            updated_output_amount: relay_data.output_amount,
            fill_type,
        },
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(relay_hash: [u8; 32], relay_data: V3RelayData)]
pub struct CloseFillPda<'info> {
    #[account(mut, address = fill_status.relayer @ SvmError::NotRelayer)]
    pub signer: Signer<'info>,

    #[account(seeds = [b"state", state.seed.to_le_bytes().as_ref()], bump)]
    pub state: Account<'info, State>,

    #[account(
        mut,
        seeds = [b"fills", relay_hash.as_ref()],
        bump,
        close = signer, // TODO: check if this is correct party to receive refund.
        // Make sure caller provided relay_hash used in PDA seeds is valid.
        constraint = is_relay_hash_valid(&relay_hash, &relay_data, &state) @ SvmError::InvalidRelayHash
    )]
    pub fill_status: Account<'info, FillStatusAccount>,
}

pub fn close_fill_pda(ctx: Context<CloseFillPda>, relay_data: V3RelayData) -> Result<()> {
    let state = &ctx.accounts.state;
    let current_time = get_current_time(state)?;

    // Check if the deposit has expired
    if current_time <= relay_data.fill_deadline {
        return err!(SvmError::CanOnlyCloseFillStatusPdaIfFillDeadlinePassed);
    }

    Ok(())
}
