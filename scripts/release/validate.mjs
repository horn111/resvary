import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertStableVersion,
  currentSha,
  publicPackages,
  readJson,
  registryPackage,
  repositoryRoot,
  run,
} from './common.mjs';

const version = process.argv[2];
assertStableVersion(version);

const releaseSha = process.env.RELEASE_SHA ?? currentSha();
if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
  throw new Error(`release_sha must be a full lowercase commit SHA, received ${releaseSha}`);
}
const checkedOutSha = run('git', ['rev-parse', 'HEAD'], { capture: true });
if (checkedOutSha !== releaseSha) {
  throw new Error(`Checked out ${checkedOutSha}; expected release SHA ${releaseSha}`);
}

if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF !== 'refs/heads/main') {
  throw new Error('Release workflows may run only from main');
}

const manifests = [
  ['package.json', await readJson('package.json')],
  ['apps/demo/package.json', await readJson('apps/demo/package.json')],
];
for (const packageInfo of publicPackages) {
  const path = `${packageInfo.directory}/package.json`;
  const manifest = await readJson(path);
  if (
    manifest.repository?.type !== 'git' ||
    manifest.repository?.url !== 'git+https://github.com/horn111/resvary.git' ||
    manifest.repository?.directory !== packageInfo.directory
  ) {
    throw new Error(`${path} must identify its exact GitHub repository directory for provenance`);
  }
  manifests.push([path, manifest]);
}

for (const [path, manifest] of manifests) {
  if (manifest.version !== version) {
    throw new Error(`${path} has version ${manifest.version}; expected ${version}`);
  }
}

const publicNames = new Set(publicPackages.map(({ name }) => name));
for (const [path, manifest] of manifests) {
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      if (publicNames.has(name) && range !== version && path !== 'apps/demo/package.json') {
        throw new Error(`${path} must depend on ${name} at exact version ${version}, not ${range}`);
      }
    }
  }
  if (manifest.publishConfig?.tag) {
    throw new Error(`${path} must not set publishConfig.tag`);
  }
  if (publicNames.has(manifest.name) || manifest.name === 'create-resvary') {
    if (manifest.publishConfig?.access !== 'public') {
      throw new Error(`${path} must keep publishConfig.access set to public`);
    }
  }
}

const lockfile = await readJson('package-lock.json');
if (lockfile.version !== version || lockfile.packages?.['']?.version !== version) {
  throw new Error('package-lock.json root version is not synchronized');
}

const template = await readFile(
  resolve(repositoryRoot, 'packages/create-resvary/src/templates/package.ts'),
  'utf8',
);
for (const name of ['@resvary/sdk', '@resvary/sqlite', '@resvary/postgres', '@resvary/worker']) {
  if (!template.includes(`"${name}": "${version}"`)) {
    throw new Error(`create-resvary template does not pin ${name}@${version}`);
  }
}

const sha = releaseSha;
const tag = `v${version}`;
const tagResult = run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`], {
  capture: true,
  allowFailure: true,
});
if (tagResult && tagResult !== sha) {
  throw new Error(`${tag} already points to ${tagResult}, not release SHA ${sha}`);
}

for (const { name } of publicPackages) {
  const packument = await registryPackage(name);
  const published = packument?.versions?.[version];
  if (published && published.gitHead !== sha) {
    throw new Error(
      `${name}@${version} already exists with gitHead ${published.gitHead ?? '<missing>'}; expected ${sha}`,
    );
  }
}

if (process.env.GITHUB_ACTIONS === 'true') {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error('GitHub workflow context is incomplete');
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/runs?head_sha=${sha}&status=completed&per_page=100`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    },
  );
  if (!response.ok)
    throw new Error(`Could not inspect CI runs: GitHub returned ${response.status}`);
  const body = await response.json();
  const successfulCi = body.workflow_runs?.some(
    (runInfo) =>
      runInfo.name === 'CI' && runInfo.head_sha === sha && runInfo.conclusion === 'success',
  );
  if (!successfulCi) throw new Error(`No successful CI workflow found for release SHA ${sha}`);
}

console.log(`Release preflight metadata passed for ${version} at ${sha}.`);
