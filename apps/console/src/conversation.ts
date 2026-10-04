export interface ConversationTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export type ConversationSubmission =
  | { readonly ok: true; readonly task: string; readonly messages: readonly ConversationTurn[] }
  | { readonly ok: false; readonly reason: 'empty' | 'too_long' };

const boundaryReply = 'I’ve captured your request in this page. This workspace is not connected to a live agent conversation yet. The only on-chain permission currently available is a fixed-recipient native MON transfer; other work is not executed or authorized here. You can keep describing the task, or review the MON permission separately.';

export function submitConversation(
  history: readonly ConversationTurn[],
  text: string,
  turnId: string,
): ConversationSubmission {
  const content = text.trim();
  if (content.length === 0) return { ok: false, reason: 'empty' };
  if (content.length > 2_000) return { ok: false, reason: 'too_long' };
  return {
    ok: true,
    task: content,
    messages: [
      ...history,
      { id: `${turnId}-user`, role: 'user', content },
      { id: `${turnId}-assistant`, role: 'assistant', content: boundaryReply },
    ],
  };
}
