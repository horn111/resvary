import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { createSqliteAdminStore } from '@resvary/sqlite/admin';

const path = resolve(value('--database') ?? '.resvary/admin-load.sqlite');
const projectId = value('--project') ?? 'load_profile';
const samples = integer('--samples', 100);
const store = createSqliteAdminStore({ path });

try {
  const overview = await timings(samples, () => store.getOverview(projectId));
  let cursor;
  const pages = await timings(samples, async () => {
    const page = await store.listAuditItems({ projectId, cursor, limit: 50 });
    cursor = page.nextCursor;
    if (!cursor) cursor = undefined;
  });
  const report = {
    database: path,
    samples,
    overviewP95Ms: percentile(overview, 0.95),
    paginatedFilterP95Ms: percentile(pages, 0.95),
    limits: { overviewMs: 2_000, paginatedFilterMs: 500 },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.overviewP95Ms > 2_000 || report.paginatedFilterP95Ms > 500) process.exitCode = 1;
} finally {
  store.close();
}

async function timings(count, operation) {
  const values = [];
  for (let index = 0; index < count + 5; index += 1) {
    const started = performance.now();
    await operation();
    if (index >= 5) values.push(performance.now() - started);
  }
  return values;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(2));
}

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function integer(flag, fallback) {
  const result = Number(value(flag) ?? fallback);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${flag} must be positive`);
  return result;
}
