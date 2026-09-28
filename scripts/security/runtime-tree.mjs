import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

export async function checkRuntimeTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (
      basename(directory) === 'node_modules' &&
      [
        'typescript',
        '@typescript',
        'prettier',
        'vitest',
        '@playwright',
        'playwright',
        'playwright-core',
      ].includes(entry.name)
    ) {
      // npm prune can leave an empty scope directory after removing its packages.
      const contents = await readdir(path);
      assert.equal(contents.length, 0, `Development tool shipped in runtime image: ${path}`);
    }
    await checkRuntimeTree(path);
  }
}
