#!/usr/bin/env node
import { getPostgresMigrationStatus, migratePostgres } from './index.js';
import { parsePostgresCliOptions, type PostgresCliOptions } from './cli-options.js';

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const options = parsePostgresCliOptions(rest);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const schema = optionString(options, 'schema') ?? process.env.RESVARY_POSTGRES_SCHEMA ?? 'public';
  const base = { connectionString, schema };

  switch (command) {
    case 'status':
      print(await getPostgresMigrationStatus(base));
      return;
    case 'migrate':
      print(await migratePostgres(base));
      return;
    case 'import-sqlite': {
      const sqlitePath = requireSqlitePath(options);
      const { importSqliteDatabase } = await import('./import-sqlite.js');
      print(
        await importSqliteDatabase({ ...base, sqlitePath, dryRun: options['dry-run'] === true }),
      );
      return;
    }
    case 'verify-import': {
      const sqlitePath = requireSqlitePath(options);
      const { verifySqliteImport } = await import('./import-sqlite.js');
      const report = await verifySqliteImport({ ...base, sqlitePath });
      print(report);
      if (
        report.balanceMismatches.length > 0 ||
        report.ledgerMismatches.length > 0 ||
        report.contentMismatches.length > 0 ||
        report.sourceOpenReservations !== report.targetOpenReservations
      ) {
        process.exitCode = 1;
      }
      return;
    }
    default:
      throw new Error(usage());
  }
}

function usage(): string {
  return 'Usage: resvary-postgres <status|migrate|import-sqlite|verify-import> [--schema NAME] [--sqlite PATH] [--dry-run]';
}

function optionString(options: PostgresCliOptions, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' ? value : undefined;
}

function requireSqlitePath(options: PostgresCliOptions): string {
  const value = optionString(options, 'sqlite');
  if (!value) throw new Error('--sqlite PATH is required');
  return value;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 1;
});
