import { spawn } from 'node:child_process';
import path from 'node:path';

const task = process.argv[2];
if (!task || !/^[a-z][a-z0-9:-]*$/i.test(task)) {
  console.error('Usage: node scripts/workspace-task.mjs <safe-script-name>');
  process.exit(2);
}

const childEnvironment = {
  ...process.env,
  DATA_ROOT: path.resolve(process.env.DATA_ROOT || './data'),
};
const isWindows = process.platform === 'win32';
const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const argumentsForCommand = isWindows
  ? ['/d', '/s', '/c', `npm run ${task} --workspaces --if-present`]
  : ['run', task, '--workspaces', '--if-present'];
const child = spawn(command, argumentsForCommand, {
  cwd: process.cwd(),
  env: childEnvironment,
  stdio: 'inherit',
});

child.once('error', (error) => {
  console.error(`Could not start npm workspace task: ${error.message}`);
  process.exit(1);
});
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`Workspace task stopped by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
