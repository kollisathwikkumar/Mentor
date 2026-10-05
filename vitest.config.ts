import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['packages/policy/src/**/*.ts', 'packages/connectors/src/**/*.ts', 'packages/intent-compiler/src/**/*.ts', 'packages/model-adapter/src/**/*.ts', 'packages/mcp-server/src/gateway.ts', 'packages/mcp-server/src/connection-status.ts', 'apps/console/src/authorization.ts', 'apps/console/src/conversation.ts', 'apps/console/src/capabilities.ts', 'apps/console/src/mcp-status.ts', 'apps/console/src/workspace-api.ts'] } },
});
