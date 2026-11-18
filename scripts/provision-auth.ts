import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { emitKeypressEvents, type Key } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { hashPassword, Role, Username } from '../src/auth/credentials.js';
import { AccountFile, defaultAuthStorePath, readAccounts } from '../src/auth/store.js';

const run = promisify(execFile);

async function restrictWindowsFile(path: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
  const sid = /"(S-1-[0-9-]+)"\s*$/i.exec(stdout)?.[1];
  if (!sid) throw new Error('Could not identify the current Windows account');
  await run('icacls.exe', [path, '/inheritance:r', '/grant:r', `*${sid}:F`], { windowsHide: true });
}

export async function provisionAccount(storePath: string, username: string, role: string, password: string): Promise<void> {
  const account = {
    id: randomUUID(),
    username: Username.parse(username),
    role: Role.parse(role),
    passwordHash: await hashPassword(password),
  };
  const path = resolve(storePath);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    const users = await readAccounts(path);
    if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
      throw new Error('Username already exists');
    }
    const data = AccountFile.parse({ version: 1, users: [...users, account] });
    const tempPath = join(directory, `users-${randomUUID()}.tmp`);
    const file = await open(tempPath, 'wx', 0o600);
    try {
      try {
        await restrictWindowsFile(tempPath);
        await file.writeFile(`${JSON.stringify(data, null, 2)}\n`);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(tempPath, path);
    } finally {
      await unlink(tempPath).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export function readHiddenPassword(input: NodeJS.ReadStream, output: NodeJS.WriteStream): Promise<string> {
  if (!input.isTTY || !output.isTTY) throw new Error('Provisioning requires an interactive terminal');
  const wasRaw = input.isRaw;
  emitKeypressEvents(input);
  return new Promise((accept, reject) => {
    let password = '';
    const finish = (error?: Error) => {
      const result = password;
      password = '';
      input.off('keypress', onKey);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else accept(result);
    };
    const onKey = (value: string | undefined, key: Key) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return finish(new Error('Cancelled'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') {
        const characters = [...password];
        characters.pop();
        password = characters.join('');
      } else if (value && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(value)) {
        if (Buffer.byteLength(password + value) > 1024) return finish(new Error('Password is too long'));
        password += value;
      }
    };
    output.write('Password (hidden): ');
    input.setRawMode(true);
    input.on('keypress', onKey);
    input.resume();
  });
}

async function main(): Promise<void> {
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run this command in an interactive terminal without arguments');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 0 });
  let username: string;
  let role: Role;
  try {
    username = Username.parse((await prompt.question('Username: ')).trim());
    role = Role.parse((await prompt.question('Role (USER or ADMIN): ')).trim().toUpperCase());
  } finally {
    prompt.close();
  }
  let password = await readHiddenPassword(process.stdin, process.stdout);
  try {
    await provisionAccount(defaultAuthStorePath(), username, role, password);
  } finally {
    password = '';
  }
  process.stdout.write('Account provisioned.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('Provisioning failed. Use a unique valid username, USER or ADMIN, and a password of 12–1024 characters (at most 1024 bytes).\n');
    process.exitCode = 1;
  });
}
