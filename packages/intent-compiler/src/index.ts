import { getAddress, isAddress, keccak256, stringToHex } from 'viem';
import { parseMonToWei } from '@mandate/policy';
import { z } from 'zod';

const candidateSchema = z.object({
  action: z.string().nullable().optional(),
  agentSigner: z.string().nullable().optional(),
  recipient: z.string().nullable().optional(),
  perCallMon: z.string().nullable().optional(),
  totalMon: z.string().nullable().optional(),
  expiresAt: z.union([z.string(), z.number()]).nullable().optional(),
  timezone: z.string().nullable().optional(),
}).strict();

export interface TextModel { complete(prompt: string): Promise<string> }

export interface PolicyPreview {
  readonly version: 1;
  readonly action: 'native_transfer';
  readonly asset: 'MON';
  readonly agentSigner: string;
  readonly recipient: string;
  readonly perCallLimitWei: string;
  readonly totalLimitWei: string;
  readonly expiresAt: number;
  readonly timezone: string;
  readonly policyHash: string;
}

export type ProposalResult =
  | { readonly status: 'ready_for_user_review'; readonly preview: PolicyPreview }
  | { readonly status: 'needs_clarification'; readonly missingFields: readonly string[]; readonly question: string };

export class IntentCompiler {
  readonly #model: TextModel;

  constructor(model: TextModel) { this.#model = model; }

  async propose(task: string): Promise<ProposalResult> {
    if (task.trim().length === 0 || task.length > 8_000) {
      return this.#clarify(['task'], 'Describe the bounded task in 1–8000 characters.');
    }
    const instructions = [
      'Extract a candidate Mandate policy from the user task. Return only one JSON object.',
      'Use exactly these fields: action, agentSigner, recipient, perCallMon, totalMon, expiresAt, timezone.',
      'Use null for anything missing or ambiguous. Never infer missing addresses, budget semantics, date, or timezone.',
      'action must be native_transfer; amounts must be decimal MON strings with at most 18 fractional digits.',
      'expiresAt must be a Unix timestamp in seconds only when date and timezone are explicit.',
      'This output is an untrusted proposal, not authorization. User must review the exact preview.',
      `User task: ${task}`,
    ].join('\n');
    let response: string;
    try { response = await this.#model.complete(instructions); }
    catch (error) {
      const httpStatus = error instanceof Error ? /^Model provider returned HTTP (\d{3})$/.exec(error.message)?.[1] : undefined;
      const question = httpStatus !== undefined
        ? `The model provider is unavailable (HTTP ${httpStatus}). Retry later or enter policy fields directly.`
        : error instanceof Error && error.name === 'TimeoutError'
          ? 'The model provider request timed out. Retry later or enter policy fields directly.'
          : error instanceof TypeError
            ? 'The model provider connection failed. Retry later or enter policy fields directly.'
            : 'The model proposal could not be retrieved. Retry or enter policy fields directly.';
      return this.#clarify(['model_response'], question);
    }

    let parsedJson: unknown;
    try { parsedJson = JSON.parse(response); }
    catch { return this.#clarify(['valid_model_output'], 'The model response was not valid JSON. Please retry or enter the policy fields directly.'); }
    const parsed = candidateSchema.safeParse(parsedJson);
    if (!parsed.success) return this.#clarify(['valid_model_output'], 'The model response did not match the required policy fields. Please retry or enter the fields directly.');
    const candidate = parsed.data;
    const missing: string[] = [];
    if (candidate.action !== 'native_transfer') missing.push('action');
    if (candidate.agentSigner === undefined || candidate.agentSigner === null || !isAddress(candidate.agentSigner)) missing.push('agentSigner');
    if (candidate.recipient === undefined || candidate.recipient === null || !isAddress(candidate.recipient)) missing.push('recipient');
    if (candidate.perCallMon === undefined || candidate.perCallMon === null || !validAmount(candidate.perCallMon)) missing.push('perCallMon');
    if (candidate.totalMon === undefined || candidate.totalMon === null || !validAmount(candidate.totalMon)) missing.push('totalMon');
    if (!isFutureExpiry(candidate.expiresAt)) missing.push('expiresAt');
    if (candidate.timezone === undefined || candidate.timezone === null || !validTimeZone(candidate.timezone)) missing.push('timezone');
    if (missing.length > 0) return this.#clarify([...new Set(missing)], 'Confirm the missing or invalid policy fields before reviewing a mandate.');

    const agentSigner = getAddress(candidate.agentSigner as string);
    const recipient = getAddress(candidate.recipient as string);
    const perCallLimitWei = parseMonToWei(candidate.perCallMon as string);
    const totalLimitWei = parseMonToWei(candidate.totalMon as string);
    if (perCallLimitWei <= 0n || totalLimitWei < perCallLimitWei) {
      return this.#clarify(['totalMon'], 'Set a positive per-transfer cap and a total budget at least as large as that cap.');
    }
    const canonical = {
      version: 1 as const,
      action: 'native_transfer' as const,
      asset: 'MON' as const,
      agentSigner,
      recipient,
      perCallLimitWei: perCallLimitWei.toString(),
      totalLimitWei: totalLimitWei.toString(),
      expiresAt: Number(candidate.expiresAt),
      timezone: candidate.timezone as string,
    };
    return {
      status: 'ready_for_user_review',
      preview: { ...canonical, policyHash: keccak256(stringToHex(JSON.stringify(canonical))) },
    };
  }

  #clarify(missingFields: readonly string[], question: string): ProposalResult {
    return { status: 'needs_clarification', missingFields, question };
  }
}

function validAmount(value: string): boolean {
  try { return parseMonToWei(value) > 0n; }
  catch { return false; }
}

function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); return value.trim().length > 0; }
  catch { return false; }
}

function isFutureExpiry(value: string | number | null | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > Math.floor(Date.now() / 1000);
  return /^\d{1,10}$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > Math.floor(Date.now() / 1000);
}
