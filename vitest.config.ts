import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['packages/policy/src/**/*.ts', 'packages/intent-compiler/src/**/*.ts', 'packages/model-adapter/src/**/*.ts', 'packages/mcp-server/src/gateway.ts', 'apps/console/src/authorization.ts'] } },
});
