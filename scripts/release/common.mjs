import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export const repositoryRoot = resolve(import.meta.dirname, '../..');

export const publicPackages = [
  { name: '@resvary/sdk', directory: 'packages/sdk', cli: null },
  { name: '@resvary/sqlite', directory: 'packages/sqlite', cli: null },
  { name: '@resvary/postgres', directory: 'packages/postgres', cli: 'dist/cli.js' },
  { name: '@resvary/circle', directory: 'packages/circle', cli: null },
  { name: '@resvary/worker', directory: 'packages/worker', cli: 'dist/cli.js' },
  { name: 'create-resvary', directory: 'packages/create-resvary', cli: 'dist/index.js' },
];

export const publishLevels = [
  ['@resvary/sdk'],
  ['@resvary/sqlite', '@resvary/postgres', '@resvary/circle'],
  ['@resvary/worker'],
  ['create-resvary'],
];

export async function readJson(path) {
  return JSON.parse(await readFile(resolve(repositoryRoot, path), 'utf8'));
}

export function run(command, args, options = {}) {
  const isWindowsNpm = process.platform === 'win32' && command === 'npm';
  const executable = isWindowsNpm ? process.env.ComSpec : command;
  const commandArgs = isWindowsNpm
    ? ['/d', '/s', '/c', ['npm.cmd', ...args].map(quoteWindowsArgument).join(' ')]
    : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd ?? repositoryRoot,
    env: {
      ...process.env,
      npm_config_cache:
        process.env.npm_config_cache ??
        resolve(process.env.RUNNER_TEMP ?? tmpdir(), 'resvary-release-npm-cache'),
      ...options.env,
    },
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}\n${result.stderr ?? ''}${result.stdout ?? ''}`,
    );
  }
  return result.stdout?.trim() ?? '';
}

function quoteWindowsArgument(value) {
  if (/^[^\s"&|<>^()%!]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function currentSha() {
  return process.env.GITHUB_SHA ?? run('git', ['rev-parse', 'HEAD'], { capture: true });
}

export async function registryPackage(name) {
  const encodedName = name.startsWith('@') ? name.replace('/', '%2f') : name;
  const response = await fetch(`https://registry.npmjs.org/${encodedName}`, {
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry returned ${response.status} for ${name}`);
  return response.json();
}

export async function waitForVersion(name, version, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const packument = await registryPackage(name);
    if (packument?.versions?.[version]) return packument.versions[version];
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  }
  throw new Error(`${name}@${version} did not become visible in npm within ${timeoutMs} ms`);
}

export function assertStableVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Expected a stable semantic version, received ${JSON.stringify(version)}`);
  }
}
