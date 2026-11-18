import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';

const encoded = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
const envelope = z.object({ version: z.literal(1), network: z.literal('regtest'),
  salt: encoded, nonce: encoded, tag: encoded, ciphertext: encoded }).strict();

/** Standard scrypt + AES-256-GCM, bound to role/id. Never logs or returns passwords. */
export function sealSecret(secret: Uint8Array, password: Uint8Array, context: string): string {
  if (password.length < 8 || secret.length < 1 || secret.length > 16384 || !context.startsWith('regtest:')) throw new Error('Invalid secret envelope limits');
  const salt = randomBytes(16); const nonce = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    return JSON.stringify({ version: 1, network: 'regtest', salt: salt.toString('base64'), nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
  } finally { key.fill(0); }
}

export function openSecret(text: string, password: Uint8Array, context: string): Buffer {
  let key: Buffer | undefined;
  try {
    if (text.length > 32768 || password.length < 8 || !context.startsWith('regtest:')) throw new Error();
    const record = envelope.parse(JSON.parse(text));
    const decode = (s: string) => { const bytes = Buffer.from(s, 'base64'); if (bytes.toString('base64') !== s) throw new Error(); return bytes; };
    const salt = decode(record.salt); const nonce = decode(record.nonce); const tag = decode(record.tag);
    if (salt.length !== 16 || nonce.length !== 12 || tag.length !== 16) throw new Error();
    key = scryptSync(password, salt, 32);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(decode(record.ciphertext)), decipher.final()]);
  } catch { throw new Error('Secret record authentication failed'); }
  finally { key?.fill(0); }
}

/** POSIX-only private records. Partial/corrupt existing records are never overwritten. */
export class SecretVault {
  #password: Buffer;
  #directory: string;
  private constructor(directory: string, password: Uint8Array) { this.#directory = directory; this.#password = Buffer.from(password); }
  static async open(directory: string, password: Uint8Array) {
    if (process.platform === 'win32' || !process.getuid) throw new Error('Secret vault requires verified POSIX permissions');
    if (password.length < 8) throw new Error('Vault password too short');
    directory = resolve(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw new Error('Vault directory permissions unsafe');
    return new SecretVault(directory, password);
  }
  private context(role: 'client' | 'refund', id: string) {
    if (role !== 'client' && role !== 'refund') throw new Error('Invalid secret record role');
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid secret record identifier');
    if (!this.#password.length) throw new Error('Secret vault closed');
    return `regtest:${role}:${id}`;
  }
  async create(role: 'client' | 'refund', id: string, secret: Uint8Array) {
    const context = this.context(role, id);
    const sealed = sealSecret(secret, this.#password, context);
    const path = join(this.#directory, `${role}-${id}.vault`);
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(sealed); await file.sync(); } finally { await file.close(); }
    const directory = await open(this.#directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async read(role: 'client' | 'refund', id: string): Promise<Buffer> {
    const context = this.context(role, id);
    const file = await open(join(this.#directory, `${role}-${id}.vault`), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.uid !== process.getuid!() || (info.mode & 0o077) !== 0 || info.nlink !== 1 || info.size > 32768) throw new Error('Secret record permissions unsafe');
      return openSecret(await file.readFile('utf8'), this.#password, context);
    } finally { await file.close(); }
  }
  close() { this.#password.fill(0); this.#password = Buffer.alloc(0); }
}
