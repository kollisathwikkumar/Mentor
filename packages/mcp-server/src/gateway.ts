import {
  evaluateTransfer,
  parseMonToWei,
  transferRequestSchema,
  type MandateSnapshot,
  type TransferRequest,
  type DenialReason,
} from '@mandate/policy';

export interface TransferReceipt {
  readonly transactionHash: string;
}

export interface MandatePort {
  getMandate(mandateId: string): Promise<MandateSnapshot>;
  executeTransfer(mandate: MandateSnapshot, amount: bigint): Promise<TransferReceipt>;
}

export interface MandateStatus {
  readonly mandateId: string;
  readonly principal: string;
  readonly active: boolean;
  readonly expired: boolean;
  readonly recipient: string;
  readonly perCallLimit: string;
  readonly totalLimit: string;
  readonly spent: string;
  readonly remaining: string;
  readonly deposited: string;
  readonly nextNonce: string;
  readonly expiresAt: number;
}

export type TransferResult =
  | { readonly status: 'denied'; readonly reason: DenialReason }
  | { readonly status: 'submitted'; readonly transactionHash: string };

export class MandateGateway {
  readonly #port: MandatePort;
  readonly #now: () => number;

  constructor(port: MandatePort, now: () => number = () => Math.floor(Date.now() / 1000)) {
    this.#port = port;
    this.#now = now;
  }

  async getStatus(mandateId: string): Promise<MandateStatus> {
    const mandate = await this.#port.getMandate(mandateId);
    const remaining = mandate.totalLimit > mandate.spent ? mandate.totalLimit - mandate.spent : 0n;
    const now = this.#now();
    return {
      mandateId: mandate.id,
      principal: mandate.principal,
      active: mandate.active,
      expired: now >= mandate.expiresAt,
      recipient: mandate.approvedRecipient,
      perCallLimit: mandate.perCallLimit.toString(),
      totalLimit: mandate.totalLimit.toString(),
      spent: mandate.spent.toString(),
      remaining: remaining.toString(),
      deposited: mandate.deposited.toString(),
      nextNonce: mandate.nextNonce.toString(),
      expiresAt: mandate.expiresAt,
    };
  }

  async requestTransfer(input: TransferRequest): Promise<TransferResult> {
    const request = transferRequestSchema.parse(input);
    const amount = parseMonToWei(request.amount);
    const mandate = await this.#port.getMandate(request.mandateId);
    const decision = evaluateTransfer({ mandate, amount, now: this.#now() });
    if (!decision.allowed) return { status: 'denied', reason: decision.reason };
    const receipt = await this.#port.executeTransfer(mandate, amount);
    return { status: 'submitted', transactionHash: receipt.transactionHash };
  }

}
