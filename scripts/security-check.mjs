import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const excluded = new Set(['node_modules', '.git', 'dist', 'coverage', 'data', 'backups', 'tmp', 'generated', 'playwright-report', 'test-results']);
const extensions = new Set(['.js', '.mjs', '.jsx', '.json', '.yml', '.yaml', '.md', '.sql', '.conf', '.ps1', '.sh']);
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath);
    else if (extensions.has(path.extname(entry.name)) || entry.name === '.env.example') {
      const text = await readFile(fullPath, 'utf8');
      const relative = path.relative(root, fullPath);
      if (relative === path.join('scripts', 'security-check.mjs')) continue;
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) findings.push(`${relative}: committed private key`);
      if (/AUTH_JWT_SECRET=(?!replace-|\$\{|<)[A-Za-z0-9+/=_-]{24,}/.test(text)) findings.push(`${relative}: literal JWT secret`);
      if (/STORAGE_MASTER_KEY_BASE64=(?!replace-|\$\{|<)[A-Za-z0-9+/=]{40,}/.test(text)) findings.push(`${relative}: literal storage key`);
      if (/DEV_SEED_PASSWORD=(?!replace-|\$\{|<)[^\s]{12,}/.test(text)) findings.push(`${relative}: literal development password`);
    }
  }
}

await walk(root);
if (findings.length) {
  console.error(`Security check failed:\n- ${findings.join('\n- ')}`);
  process.exit(1);
}
console.log('Security check passed: no committed private keys or literal runtime secrets found.');
