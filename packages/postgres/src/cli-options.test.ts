import { describe, expect, it } from 'vitest';
import { parsePostgresCliOptions } from './cli-options.js';

describe('parsePostgresCliOptions', () => {
  it('accepts non-secret operational options', () => {
    expect(
      parsePostgresCliOptions(['--schema', 'billing', '--sqlite=data.sqlite', '--dry-run']),
    ).toEqual({ schema: 'billing', sqlite: 'data.sqlite', 'dry-run': true });
  });

  it('rejects database credentials in both argv forms', () => {
    expect(() =>
      parsePostgresCliOptions(['--database-url', 'postgres://user:secret@localhost/db']),
    ).toThrow('Unknown option: --database-url');
    expect(() =>
      parsePostgresCliOptions(['--database-url=postgres://user:secret@localhost/db']),
    ).toThrow('Unknown option: --database-url');
  });
});
