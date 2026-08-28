import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

export function prepareSqliteDatabasePath(path: string, createDirectory = true): void {
  if (path === ':memory:') return;

  if (createDirectory) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }

  if (!existsSync(path)) {
    try {
      closeSync(openSync(path, 'wx', 0o600));
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
  }
}

export function hardenSqliteDatabaseFiles(path: string): void {
  if (path === ':memory:' || process.platform === 'win32') return;

  for (const suffix of ['', '-wal', '-shm']) {
    const candidate = `${path}${suffix}`;
    if (existsSync(candidate)) chmodSync(candidate, 0o600);
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}
