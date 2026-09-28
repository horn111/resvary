import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { checkRuntimeTree } from './runtime-tree.mjs';

await checkRuntimeTree('/workspace');
const require = createRequire('/workspace/apps/agent-demo/package.json');
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
    "await import('@resvary/sdk'); await import('@resvary/postgres'); await import('@resvary/circle'); await import('pg'); await import('./src/lib/runtime.ts'); await import('./src/lib/engine.ts');",
  ],
  { cwd: '/workspace/apps/agent-demo', stdio: 'inherit', timeout: 30_000 },
);
console.log('Runtime and worker imports load; Circle CLI starts; development tools are absent.');
