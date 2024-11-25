use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    constants::DISCRIMINATOR_SIZE,
    error::SvmError,
    event::ClaimedRelayerRefund,
    state::{ClaimAccount, State},
};

#[derive(Accounts)]
#[instruction(mint: Pubkey, refund_address: Pubkey)]
pub struct InitializeClaimAccount<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = DISCRIMINATOR_SIZE + ClaimAccount::INIT_SPACE,
        seeds = [b"claim_account", mint.as_ref(), refund_address.as_ref()],
        bump
    )]
    pub claim_account: Account<'info, ClaimAccount>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_claim_account(ctx: Context<InitializeClaimAccount>) -> Result<()> {
    // Store the initializer so only it can receive lamports from closing the account upon claiming the refund.
    ctx.accounts.claim_account.initializer = ctx.accounts.signer.key();

    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct ClaimRelayerRefund<'info> {
    pub signer: Signer<'info>,

    /// CHECK: We don't need any additional checks as long as this is the same account that initialized the claim account.
    #[account(mut, address = claim_account.initializer @ SvmError::InvalidClaimInitializer)]
    pub initializer: UncheckedAccount<'info>,

    #[account(seeds = [b"state", state.seed.to_le_bytes().as_ref()], bump)]
    pub state: Account<'info, State>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = state,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    // Mint address has been checked when executing the relayer refund leaf and it is part of claim account derivation.
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    // This method allows relayer to claim refunds on any custom token account.
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub token_account: InterfaceAccount<'info, TokenAccount>,

    // Only relayer can claim the refund with this method as the claim account is derived from the relayer's address.
    #[account(
        mut,
        close = initializer,
        seeds = [b"claim_account", mint.key().as_ref(), signer.key().as_ref()],
        bump
    )]
    pub claim_account: Account<'info, ClaimAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn claim_relayer_refund(ctx: Context<ClaimRelayerRefund>) -> Result<()> {
    // Ensure the claim account holds a non-zero amount.
    let claim_amount = ctx.accounts.claim_account.amount;
    if claim_amount == 0 {
        return err!(SvmError::ZeroRefundClaim);
    }

    // Derive the signer seeds for the state required for the transfer form vault.
    let state_seed_bytes = ctx.accounts.state.seed.to_le_bytes();
    let seeds = &[b"state", state_seed_bytes.as_ref(), &[ctx.bumps.state]];
    let signer_seeds = &[&seeds[..]];

    // Transfer the claim amount from the vault to the relayer token account.
    let transfer_accounts = TransferChecked {
        from: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.token_account.to_account_info(),
        authority: ctx.accounts.state.to_account_info(),
    };
    let cpi_context =
        CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_accounts, signer_seeds);
    transfer_checked(cpi_context, claim_amount, ctx.accounts.mint.decimals)?;

    emit_cpi!(ClaimedRelayerRefund {
        l2_token_address: ctx.accounts.mint.key(),
        claim_amount,
        refund_address: ctx.accounts.signer.key(),
    });

    Ok(()) // There is no need to reset the claim amount as the account will be closed at the end of instruction.
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(refund_address: Pubkey)]
pub struct ClaimRelayerRefundFor<'info> {
    pub signer: Signer<'info>,

    /// CHECK: We don't need any additional checks as long as this is the same account that initialized the claim account.
    #[account(mut, address = claim_account.initializer @ SvmError::InvalidClaimInitializer)]
    pub initializer: UncheckedAccount<'info>,

    #[account(seeds = [b"state", state.seed.to_le_bytes().as_ref()], bump)]
    pub state: Account<'info, State>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = state,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    // Mint address has been checked when executing the relayer refund leaf and it is part of claim account derivation.
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = refund_address,
        associated_token::token_program = token_program
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        close = initializer,
        seeds = [b"claim_account", mint.key().as_ref(), refund_address.as_ref()],
        bump
    )]
    pub claim_account: Account<'info, ClaimAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn claim_relayer_refund_for(ctx: Context<ClaimRelayerRefundFor>, refund_address: Pubkey) -> Result<()> {
    // Ensure the claim account holds a non-zero amount.
    let claim_amount = ctx.accounts.claim_account.amount;
    if claim_amount == 0 {
        return err!(SvmError::ZeroRefundClaim);
    }

    // Derive the signer seeds for the state required for the transfer form vault.
    let state_seed_bytes = ctx.accounts.state.seed.to_le_bytes();
    let seeds = &[b"state", state_seed_bytes.as_ref(), &[ctx.bumps.state]];
    let signer_seeds = &[&seeds[..]];

    // Transfer the claim amount from the vault to the relayer token account.
    let transfer_accounts = TransferChecked {
        from: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.token_account.to_account_info(),
        authority: ctx.accounts.state.to_account_info(),
    };
    let cpi_context =
        CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_accounts, signer_seeds);
    transfer_checked(cpi_context, claim_amount, ctx.accounts.mint.decimals)?;

    emit_cpi!(ClaimedRelayerRefund { l2_token_address: ctx.accounts.mint.key(), claim_amount, refund_address });

    Ok(()) // There is no need to reset the claim amount as the account will be closed at the end of instruction.
}

// Though claim accounts are being closed automatically when claiming the refund, there might be a scenario where
// relayer refunds were executed with ATA after initializing the claim account. In such cases, the initializer should be
// able to close the claim account manually.
#[derive(Accounts)]
#[instruction(mint: Pubkey, refund_address: Pubkey)]
pub struct CloseClaimAccount<'info> {
    #[account(mut, address = claim_account.initializer @ SvmError::InvalidClaimInitializer)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        close = signer,
        seeds = [b"claim_account", mint.key().as_ref(), refund_address.key().as_ref()],
        bump
    )]
    pub claim_account: Account<'info, ClaimAccount>,
}

pub fn close_claim_account(ctx: Context<CloseClaimAccount>) -> Result<()> {
    // Ensure the account does not hold any outstanding claims.
    let claim_amount = ctx.accounts.claim_account.amount;
    if claim_amount > 0 {
        return err!(SvmError::NonZeroRefundClaim);
    }

    Ok(())
}
