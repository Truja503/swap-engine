import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Database } from '../core/SwapTypes.js';

/** Single process, serialized copy-on-write transactions; fsync before atomic rename. */
export class Store {
  private db: Database = { schema: 1, quotes: {}, swaps: {} };
  private queue: Promise<unknown> = Promise.resolve();
  private poisoned = false;
  private constructor(private directory: string) {}
  static async open(directory: string): Promise<Store> {
    const store = new Store(resolve(directory));
    await mkdir(store.directory, { recursive: true, mode: 0o700 });
    const lock = await open(join(store.directory, 'engine.lock'), 'wx', 0o600);
    await lock.writeFile(String(process.pid)); await lock.sync(); await lock.close();
    try {
      try {
        store.db = JSON.parse(await readFile(join(store.directory, 'state.json'), 'utf8')) as Database;
        if (store.db.schema !== 1 || !store.db.swaps || !store.db.quotes) throw new Error('Unsupported database');
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      return store;
    } catch (e) { await unlink(join(store.directory, 'engine.lock')); throw e; }
  }
  read(): Database {
    if (this.poisoned) throw new Error('Persistence outcome uncertain; restart and reconcile');
    return structuredClone(this.db);
  }
  transaction<T>(fn: (draft: Database) => T): Promise<T> {
    const action = this.queue.then(async () => {
      if (this.poisoned) throw new Error('Persistence outcome uncertain; restart and reconcile');
      const draft = structuredClone(this.db);
      const result = fn(draft);
      const temp = join(this.directory, 'state.tmp');
      const file = await open(temp, 'w', 0o600);
      try { await file.writeFile(JSON.stringify(draft)); await file.sync(); } finally { await file.close(); }
      try {
        await rename(temp, join(this.directory, 'state.json'));
      // Persist the directory entry on POSIX; Windows does not support directory fsync.
        if (process.platform !== 'win32') {
          const directory = await open(this.directory, 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } catch (error) { this.poisoned = true; throw error; }
      this.db = draft;
      return structuredClone(result);
    });
    this.queue = action.catch(() => {});
    return action;
  }
  async close() { await this.queue; await unlink(join(this.directory, 'engine.lock')); }
}
