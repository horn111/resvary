import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateProject } from './generator.js';
import type { ProjectConfig } from './prompts.js';

describe('generateProject', () => {
  let originalDirectory: string;
  let testDirectory: string;
  const config: ProjectConfig = {
    projectName: 'safe-project',
    framework: 'express',
    template: 'ai-credits',
    database: 'sqlite',
    pricing: 'request',
    payTo: '0x0000000000000000000000000000000000000000',
  };

  beforeEach(async () => {
    originalDirectory = process.cwd();
    testDirectory = await mkdtemp(join(tmpdir(), 'create-resvary-'));
    process.chdir(testDirectory);
  });

  afterEach(async () => {
    process.chdir(originalDirectory);
    await rm(testDirectory, { recursive: true, force: true });
  });

  it('creates a new project without overwriting existing files', async () => {
    await generateProject(config);
    const manifest = JSON.parse(
      await readFile(join(testDirectory, config.projectName, 'package.json'), 'utf8'),
    ) as { name: string };
    expect(manifest.name).toBe(config.projectName);

    await expect(generateProject(config)).rejects.toThrow('Target directory is not empty');
  });

  it.each(['.', '..', '../outside', 'nested/project', 'BadName', 'bad"name'])(
    'rejects unsafe project name %s',
    async (projectName) => {
      await expect(generateProject({ ...config, projectName })).rejects.toThrow(
        'Project name must be a lowercase npm-compatible name',
      );
    },
  );

  it('does not overwrite a non-empty target directory', async () => {
    const target = join(testDirectory, config.projectName);
    await mkdir(target);
    await writeFile(join(target, 'package.json'), '{"private":true}\n');

    await expect(generateProject(config)).rejects.toThrow('Target directory is not empty');
    expect(await readFile(join(target, 'package.json'), 'utf8')).toBe('{"private":true}\n');
  });
});
