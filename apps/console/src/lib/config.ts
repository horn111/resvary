import { resolve } from 'node:path';

export interface ConsoleConfig {
  projectId: string;
  adminSecret: string;
  demoMode: boolean;
  backend: { kind: 'sqlite'; path: string } | { kind: 'postgres'; connectionString: string };
}

export function getConsoleConfig(): ConsoleConfig {
  const projectId = requireValue('RESVARY_PROJECT_ID');
  const adminSecret = requireValue('RESVARY_CONSOLE_ADMIN_SECRET');
  if (adminSecret.length < 32) {
    throw new Error('RESVARY_CONSOLE_ADMIN_SECRET must contain at least 32 characters');
  }
  const demoMode = process.env.RESVARY_CONSOLE_DEMO_MODE === 'true';
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const sqlitePath = process.env.RESVARY_SQLITE_PATH?.trim();
  if (demoMode) {
    if (databaseUrl) throw new Error('Demo mode refuses DATABASE_URL');
    if (sqlitePath) throw new Error('Demo mode only accepts the bundled synthetic SQLite fixture');
    return {
      projectId,
      adminSecret,
      demoMode,
      backend: { kind: 'sqlite', path: resolve(process.cwd(), 'fixtures', 'demo.sqlite') },
    };
  }
  if (Boolean(databaseUrl) === Boolean(sqlitePath)) {
    throw new Error('Configure exactly one of DATABASE_URL or RESVARY_SQLITE_PATH');
  }
  return {
    projectId,
    adminSecret,
    demoMode,
    backend: databaseUrl
      ? { kind: 'postgres', connectionString: databaseUrl }
      : { kind: 'sqlite', path: resolve(sqlitePath!) },
  };
}

function requireValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
