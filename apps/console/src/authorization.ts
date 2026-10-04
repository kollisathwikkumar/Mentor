import { isAddress, parseEther, type Address } from 'viem';

export interface AuthorizationDraft {
  readonly task: string;
  readonly agent: string;
  readonly recipient: string;
  readonly perCallMon: string;
  readonly totalMon: string;
  readonly expiresAt: string;
}

export type AuthorizationReview =
  | { readonly ok: true; readonly agent: Address; readonly recipient: Address; readonly expiresAt: bigint; readonly perCallWei: bigint; readonly totalWei: bigint }
  | { readonly ok: false; readonly message: string };

export function validateAuthorizationDraft(draft: AuthorizationDraft, nowUnix: number): AuthorizationReview {
  if (!draft.task.trim()) {
    return { ok: false, message: 'Describe the job this agent should handle before defining its access.' };
  }
  if (!isAddress(draft.agent)) {
    return { ok: false, message: 'Enter a valid agent signer address.' };
  }
  if (!isAddress(draft.recipient)) {
    return { ok: false, message: 'Enter a valid fixed destination address.' };
  }
  const expiresAtMs = Date.parse(draft.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowUnix * 1000) {
    return { ok: false, message: 'Choose a valid expiry in the future.' };
  }

  let perCallWei: bigint;
  let totalWei: bigint;
  try {
    perCallWei = parseEther(draft.perCallMon);
    totalWei = parseEther(draft.totalMon);
  } catch {
    return { ok: false, message: 'Enter valid MON limits with at most 18 decimal places.' };
  }
  if (perCallWei <= 0n || totalWei < perCallWei) {
    return { ok: false, message: 'The per-action limit must be positive and fit within the total budget.' };
  }

  return {
    ok: true,
    agent: draft.agent,
    recipient: draft.recipient,
    expiresAt: BigInt(Math.floor(expiresAtMs / 1000)),
    perCallWei,
    totalWei,
  };
}
