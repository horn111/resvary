#!/usr/bin/env node
import { getPostgresMigrationStatus, migratePostgres } from './index.js';

type Options = Record<string, string | boolean>;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseOptions(rest);
  const connectionString = optionString(options, 'database-url') ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL or --database-url is required');
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
        report.sourceOpenReservations !== report.targetOpenReservations
      ) {
        process.exitCode = 1;
      }
      return;
    }
    default:
      throw new Error(
        'Usage: resvary-postgres <status|migrate|import-sqlite|verify-import> [--database-url URL] [--schema NAME] [--sqlite PATH] [--dry-run]',
      );
  }
}

function parseOptions(args: string[]): Options {
  const options: Options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function optionString(options: Options, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' ? value : undefined;
}

function requireSqlitePath(options: Options): string {
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
