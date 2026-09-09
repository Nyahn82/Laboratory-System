import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const envFile = path.join(root, '.env');

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

let fileEnv;
try {
  fileEnv = parseEnv(await readFile(envFile, 'utf8'));
} catch {
  console.error('Missing .env. Run "npm run setup" before starting local development.');
  process.exit(1);
}

await mkdir(path.join(root, 'data'), { recursive: true });
const baseEnv = {
  ...process.env,
  ...fileEnv,
  NODE_ENV: 'development',
  DB_DRIVER: 'file',
  OBJECT_STORE_DRIVER: 'filesystem',
  LEDGER_DRIVER: 'file',
  DATA_ROOT: path.join(root, 'data'),
  PUBLIC_BASE_URL: fileEnv.NATIVE_PUBLIC_BASE_URL || 'http://localhost:5173',
};

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const processes = [
  ['AUTH', ['run', 'dev', '--workspace', '@rhu-labchain/auth-service'], { PORT: fileEnv.AUTH_PORT || '3001' }],
  ['RECORDS', ['run', 'dev', '--workspace', '@rhu-labchain/records-service'], { PORT: fileEnv.RECORDS_PORT || '3002' }],
  ['STORAGE', ['run', 'dev', '--workspace', '@rhu-labchain/storage-service'], { PORT: fileEnv.STORAGE_PORT || '3003' }],
  ['VERIFY', ['run', 'dev', '--workspace', '@rhu-labchain/verification-service'], { PORT: fileEnv.VERIFICATION_PORT || '3004' }],
  ['WEB', ['run', 'dev', '--workspace', '@rhu-labchain/web'], {}],
].map(([name, args, extraEnv]) => {
  const commandArgs = isWindows
    ? ['/d', '/s', '/c', `npm ${args.join(' ')}`]
    : args;
  const child = spawn(npmCommand, commandArgs, { cwd: root, env: { ...baseEnv, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`[${name}] stopped with exit code ${code}.`);
  });
  return child;
});

console.log('RHU LabChain native stack is starting. Open http://localhost:5173');
const stop = () => {
  for (const child of processes) {
    if (isWindows && child.pid) {
      spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
