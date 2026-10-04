import { z } from 'zod';
import type { IntentCompiler } from '@mandate/intent-compiler';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerModelProposalTool(server: McpServer, compiler: Pick<IntentCompiler, 'propose'>): void {
  server.registerTool('propose_mandate', {
    title: 'Propose a mandate (review only)',
    description: 'Use Gemini 3.8 Flash to extract a policy proposal for review. This tool never creates, signs, funds, or submits a transaction.',
    inputSchema: { task: z.string().trim().min(1).max(8_000) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  }, async ({ task }) => {
    try {
      const result = await compiler.propose(task);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch {
      return { isError: true, content: [{ type: 'text', text: 'Mandate proposal could not be generated.' }] };
    }
  });
}
