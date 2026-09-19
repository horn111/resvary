import { afterEach, describe, expect, it } from 'vitest';
import { getDemoPersistenceLabel } from './store';

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalSqlitePath = process.env.RESVARY_CREDITS_DB_PATH;

afterEach(() => {
  restore('DATABASE_URL', originalDatabaseUrl);
  restore('RESVARY_CREDITS_DB_PATH', originalSqlitePath);
});

describe('demo credit persistence', () => {
  it('selects PostgreSQL without exposing its connection string', () => {
    process.env.DATABASE_URL = 'postgres://private:secret@example.test/resvary';
    process.env.RESVARY_CREDITS_DB_PATH = '.resvary/ignored.sqlite';

    expect(getDemoPersistenceLabel()).toBe('PostgreSQL');
  });

  it('keeps SQLite as the local fallback', () => {
    delete process.env.DATABASE_URL;
    process.env.RESVARY_CREDITS_DB_PATH = '.resvary/custom.sqlite';

    expect(getDemoPersistenceLabel()).toBe('.resvary/custom.sqlite');
  });

  it('uses the documented SQLite path when no persistence variables exist', () => {
    delete process.env.DATABASE_URL;
    delete process.env.RESVARY_CREDITS_DB_PATH;

    expect(getDemoPersistenceLabel()).toBe('.resvary/demo.sqlite');
  });
});

function restore(key: 'DATABASE_URL' | 'RESVARY_CREDITS_DB_PATH', value?: string) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
