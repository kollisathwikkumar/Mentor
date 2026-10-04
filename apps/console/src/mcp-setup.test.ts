import { describe, expect, it } from 'vitest';
import { buildMcpSetup, type McpClient } from './mcp-setup.js';

describe('buildMcpSetup', () => {
  it('creates a Codex local stdio registration command with the selected repository path', () => {
    const setup = buildMcpSetup('codex', '/Users/example/METROPOLIS');
    expect(setup.config).toContain('codex mcp add mandate -- npm');
    expect(setup.config).toContain("'/Users/example/METROPOLIS'");
    expect(setup.config).toContain('@mandate/mcp-server');
  });

  it('creates a Cursor JSON configuration without embedding secrets', () => {
    const setup = buildMcpSetup('cursor', '/Users/example/METROPOLIS');
    const parsed: { mcpServers: Record<string, { command: string; args: string[] }> } = JSON.parse(setup.config);
    const mandate = parsed.mcpServers.mandate;
    expect(mandate).toBeDefined();
    if (!mandate) throw new Error('Generated configuration is missing the Mandate server.');
    expect(mandate.command).toBe('npm');
    expect(mandate.args).toContain('/Users/example/METROPOLIS');
    expect(setup.config).not.toContain('PRIVATE_KEY');
    expect(setup.config).not.toContain('API_KEY');
  });

  it('creates a Claude Code CLI command with safely quoted paths', () => {
    const setup = buildMcpSetup('claude-code', "/Users/example/METRO POLIS");
    expect(setup.config).toContain("'/Users/example/METRO POLIS'");
    expect(setup.config).toContain('claude mcp add');
    const quoted = buildMcpSetup('codex', "/Users/example/O'Connor/METROPOLIS");
    expect(quoted.config).toContain("O'\\''Connor/METROPOLIS");
  });

  it('rejects relative, empty, or newline-containing paths', () => {
    const badPaths = ['', 'METROPOLIS', '/tmp/project\n--danger'];
    for (const path of badPaths) {
      expect(() => buildMcpSetup('codex', path)).toThrow('Enter an absolute project folder path.');
    }
  });

  it('provides client-specific verification steps', () => {
    const clients: readonly McpClient[] = ['codex', 'cursor', 'claude-code'];
    for (const client of clients) {
      const setup = buildMcpSetup(client, '/Users/example/METROPOLIS');
      expect(setup.verify.length).toBeGreaterThan(0);
      expect(setup.location.length).toBeGreaterThan(0);
    }
  });
});
