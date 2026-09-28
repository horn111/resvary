import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Run inside the built image. Check nested dependencies as well as root packages.
async function checkTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (directory.endsWith('/node_modules')) {
      assert(
        !['typescript', '@typescript', 'prettier', 'vitest', '@playwright'].includes(entry.name),
        `Development tool shipped in runtime image: ${path}`,
      );
    }
    await checkTree(path);
  }
}

await checkTree('/workspace');
const require = createRequire('/workspace/apps/agent-demo/package.json');
for (const name of ['@resvary/sdk', '@resvary/postgres', '@resvary/circle', 'pg']) {
  await import(require.resolve(name));
}
const cli = require.resolve('@circle-fin/cli');
const version = execFileSync(process.execPath, [cli, '--version'], {
  encoding: 'utf8',
  timeout: 30_000,
  env: process.env,
});
assert.match(version, /\d+\.\d+\.\d+/);
// The same image runs Compose migrations and the worker through tsx/esbuild.
execFileSync(
  process.execPath,
  [
    '--import',
    require.resolve('tsx'),
    '--input-type=module',
    '--eval',
    "await import('./src/lib/runtime.ts'); await import('./src/lib/engine.ts');",
  ],
  { cwd: '/workspace/apps/agent-demo', stdio: 'inherit', timeout: 30_000 },
);
console.log('Runtime and worker imports load; Circle CLI starts; development tools are absent.');
