import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRuntimeTree } from './runtime-tree.mjs';

test('allows empty npm scopes left after pruning', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'resvary-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'node_modules', '@playwright'), { recursive: true });
  await mkdir(join(root, 'node_modules', '@typescript'), { recursive: true });
  await checkRuntimeTree(root);
});

for (const packagePath of [
  'node_modules/typescript',
  'node_modules/@typescript/typescript-linux-x64',
  'node_modules/@playwright/test',
  'apps/agent-demo/node_modules/typescript',
  'node_modules/workflow/node_modules/typescript',
]) {
  test(`rejects runtime tool package ${packagePath}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'resvary-runtime-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, packagePath);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), '{}');
    await assert.rejects(checkRuntimeTree(root), /Development tool shipped in runtime image/);
  });
}
