import { describe, expect, it } from 'vitest';
import { buildMcpSetup } from './mcp-setup.js';

describe('buildMcpSetup', () => {
  it('creates a Codex Streamable HTTP registration without embedding bearer credentials', () => {
    const setup = buildMcpSetup('https://mandate-console.pages.dev/mcp');
    expect(setup.config).toBe("codex mcp add mandate-cloud --url 'https://mandate-console.pages.dev/mcp' --bearer-token-env-var MANDATE_MCP_TOKEN");
    expect(setup.config).not.toContain('PRIVATE_KEY');
    expect(setup.config).not.toContain('API_KEY');
    expect(setup.config).not.toContain('token-value');
    expect(setup.verify).toContain('codex mcp list');
  });

  it('quotes shell metacharacters in otherwise valid URLs', () => {
    const setup = buildMcpSetup("https://example.com/a'b");
    expect(setup.config).toContain("'https://example.com/a'\\''b'");
  });

  it('rejects non-HTTPS, credential-bearing, and query-string endpoints', () => {
    const invalidEndpoints = [
      'http://localhost:8788/mcp',
      'https://user:secret@example.com/mcp',
      'https://example.com/mcp?token=secret',
      'not a URL',
    ];
    for (const endpoint of invalidEndpoints) {
      expect(() => buildMcpSetup(endpoint)).toThrow();
    }
  });
});
