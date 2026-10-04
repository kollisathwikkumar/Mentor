import { z } from 'zod';

const mandateIdPattern = /^0x[0-9a-fA-F]{64}$/;
const decimalAmountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

export const transferRequestSchema = z.object({
  mandateId: z.string().regex(mandateIdPattern),
  amount: z.string().regex(decimalAmountPattern),
}).strict();

export type TransferRequest = z.infer<typeof transferRequestSchema>;

export interface MandateSnapshot {
  readonly id: string;
  readonly principal: string;
  readonly agentSigner: string;
  readonly approvedRecipient: string;
  readonly perCallLimit: bigint;
  readonly totalLimit: bigint;
  readonly spent: bigint;
  readonly deposited: bigint;
  readonly expiresAt: number;
  readonly nextNonce: bigint;
  readonly active: boolean;
}

export type DenialReason =
  | 'MANDATE_INACTIVE'
  | 'MANDATE_EXPIRED'
  | 'INVALID_AMOUNT'
  | 'PER_CALL_LIMIT'
  | 'TOTAL_LIMIT'
  | 'INSUFFICIENT_DEPOSIT';

export type TransferDecision =
  | { readonly allowed: true; readonly reason: 'ALLOW' }
  | { readonly allowed: false; readonly reason: DenialReason };

export interface TransferEvaluationInput {
  readonly mandate: MandateSnapshot;
  readonly amount: bigint;
  readonly now: number;
}

export function parseMonToWei(value: string): bigint {
  if (!decimalAmountPattern.test(value)) {
    throw new TypeError('Amount must be a non-negative decimal with at most 18 fractional digits');
  }
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
}

export function evaluateTransfer(input: TransferEvaluationInput): TransferDecision {
  const { mandate, amount, now } = input;
  if (!mandate.active) return { allowed: false, reason: 'MANDATE_INACTIVE' };
  if (!Number.isSafeInteger(now) || now >= mandate.expiresAt) {
    return { allowed: false, reason: 'MANDATE_EXPIRED' };
  }
  if (amount <= 0n) return { allowed: false, reason: 'INVALID_AMOUNT' };
  if (amount > mandate.perCallLimit) return { allowed: false, reason: 'PER_CALL_LIMIT' };
  if (mandate.spent + amount > mandate.totalLimit) return { allowed: false, reason: 'TOTAL_LIMIT' };
  if (amount > mandate.deposited) return { allowed: false, reason: 'INSUFFICIENT_DEPOSIT' };
  return { allowed: true, reason: 'ALLOW' };
}
