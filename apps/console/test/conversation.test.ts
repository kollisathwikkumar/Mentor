import { describe, expect, it } from 'vitest';
import { submitConversation, type ConversationTurn } from '../src/conversation.js';

const existing: readonly ConversationTurn[] = [
  { id: 'welcome', role: 'assistant', content: 'What would you like the agent to handle?' },
];

describe('conversation composer', () => {
  it('accepts open-ended task text without selecting a task category', () => {
    const result = submitConversation(existing, '  Organize my weekly project updates  ', 'turn-1');
    expect(result).toMatchObject({
      ok: true,
      task: 'Organize my weekly project updates',
      messages: [
        existing[0],
        { id: 'turn-1-user', role: 'user', content: 'Organize my weekly project updates' },
        { id: 'turn-1-assistant', role: 'assistant' },
      ],
    });
  });

  it('keeps the current enforcement boundary explicit and does not claim execution', () => {
    const result = submitConversation([], 'Summarize these invoices', 'turn-2');
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.messages[1]?.content).toContain('not connected to a live agent');
      expect(result.messages[1]?.content).toContain('fixed-recipient native MON');
      expect(result.messages[1]?.content).not.toContain('Done');
    }
  });

  it('rejects empty and oversized messages without changing history', () => {
    expect(submitConversation(existing, ' \n ', 'turn-3')).toEqual({ ok: false, reason: 'empty' });
    expect(submitConversation(existing, 'x'.repeat(2_001), 'turn-4')).toEqual({ ok: false, reason: 'too_long' });
  });
});
