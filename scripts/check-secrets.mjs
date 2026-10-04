import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ignored = new Set(['node_modules', '.git', 'dist', 'out', 'coverage', '.venv-scrapling', '.scrapling_cache']);
const ignoredFiles = new Set(['.env.local']);
const patterns = [
  /nvapi-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /MANDATE_AGENT_PRIVATE_KEY\s*=\s*0x[0-9a-fA-F]{64}/,
  /NVIDIA_API_KEY[ \t]*=[ \t]*[^ \t\r\n$<][^\r\n]*/,
];
const findings = [];

async function scan(path) {
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    if (entry.isFile() && ignoredFiles.has(entry.name)) continue;
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) await scan(fullPath);
    else {
      const contents = await readFile(fullPath, 'utf8').catch(() => '');
      if (patterns.some((pattern) => pattern.test(contents))) findings.push(relative(process.cwd(), fullPath));
    }
  }
}

await scan(process.cwd());
if (findings.length > 0) {
  process.stderr.write(`Potential credential material detected in ${findings.length} file(s): ${findings.join(', ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Secret scan passed: no credential values detected in scanned project files.\n');
}
