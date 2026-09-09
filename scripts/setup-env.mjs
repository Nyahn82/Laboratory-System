import { randomBytes } from 'node:crypto';
import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const examplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');

try {
  await access(envPath, constants.F_OK);
  console.log('.env already exists; no values were overwritten.');
  process.exit(0);
} catch {
  // Expected for a first-time setup.
}

await copyFile(examplePath, envPath);
let content = await readFile(envPath, 'utf8');
const randomHex = () => randomBytes(32).toString('hex');
const randomPassword = () => `Dev-${randomBytes(18).toString('base64url')}!`;

const replacements = new Map([
  ['replace-with-random-jwt-secret', randomHex()],
  ['replace-with-random-service-token', randomHex()],
  ['replace-with-random-qr-secret', randomHex()],
  ['replace-with-32-random-bytes-as-base64', randomBytes(32).toString('base64')],
  ['replace-with-a-unique-development-password', randomPassword()],
  ['replace-with-a-random-root-password', randomPassword()],
  ['replace-with-a-random-application-password', randomPassword()],
]);

for (const [placeholder, value] of replacements) {
  content = content.replaceAll(placeholder, value);
}
await writeFile(envPath, content, { encoding: 'utf8', mode: 0o600 });
console.log('Created .env with random local-only secrets. Keep this file private.');
