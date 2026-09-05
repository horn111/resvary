import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertReleaseVersion,
  currentSha,
  publicPackages,
  publishLevels,
  registryPackage,
  releaseChannel,
  run,
} from './common.mjs';
import { createPublicationPlan } from './publication-plan.mjs';

const command = process.argv[2];
const version = process.argv[3];
assertReleaseVersion(version);
const channel = releaseChannel(version);
const artifactDirectory = resolve(
  process.env.RELEASE_ARTIFACT_DIR ?? join(tmpdir(), 'resvary-release-artifacts'),
);

if (command === 'publish') await publishPackages();
else if (command === 'finalize') await finalizeRelease();
else if (command === 'github-release') await createGitHubRelease();
else throw new Error('Usage: registry.mjs <publish|finalize|github-release> <version>');

async function loadArtifactManifest() {
  const manifest = JSON.parse(
    await readFile(join(artifactDirectory, 'sha256-manifest.json'), 'utf8'),
  );
  if (manifest.version !== version || manifest.packages.length !== publicPackages.length) {
    throw new Error('Release artifact manifest is incomplete or has the wrong version');
  }
  if (manifest.packages.some((entry) => entry.gitHead !== currentSha())) {
    throw new Error('Release artifacts do not match release_sha');
  }
  for (const entry of manifest.packages) {
    const bytes = await readFile(join(artifactDirectory, entry.file));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== entry.sha256) throw new Error(`SHA-256 mismatch for ${entry.file}`);
  }
  return manifest;
}

async function publishPackages() {
  const manifest = await loadArtifactManifest();
  const artifacts = new Map(manifest.packages.map((entry) => [entry.name, entry]));
  const packageStates = await Promise.all(
    publicPackages.map(async ({ name }) => ({ name, packument: await registryPackage(name) })),
  );
  const plan = createPublicationPlan({
    version,
    releaseSha: currentSha(),
    packageStates,
    publishLevels,
  });
  console.log(
    plan.previousLatest
      ? `Publishing ${version} to ${plan.channel} over synchronized latest ${plan.previousLatest}.`
      : `All packages for ${version} are already public; verifying the existing publication.`,
  );

  for (const level of plan.levels) {
    for (const { name, action } of level) {
      const artifact = artifacts.get(name);
      if (!artifact) throw new Error(`No checked artifact found for ${name}`);
      if (action === 'skip') {
        console.log(`Skipping ${name}@${version}; matching release is already public.`);
        continue;
      }
      run('npm', [
        'publish',
        join(artifactDirectory, artifact.file),
        '--tag',
        channel,
        '--access',
        'public',
        '--provenance',
      ]);
    }
    if (channel === 'latest') {
      for (const { name } of level) {
        const packument = await registryPackage(name);
        if (packument?.['dist-tags']?.next) {
          run('npm', ['dist-tag', 'rm', name, 'next']);
        }
      }
    }
    for (const { name } of level) await waitForPublishedPackage(name);
  }
  console.log('All packages are public with matching provenance and release metadata.');
}

async function waitForPublishedPackage(name, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  const sha = currentSha();
  while (Date.now() < deadline) {
    const packument = await registryPackage(name);
    const published = packument?.versions?.[version];
    if (
      packument?.['dist-tags']?.[channel] === version &&
      packument?.['dist-tags']?.alpha === '0.5.0-alpha.3' &&
      (channel === 'next' || packument?.['dist-tags']?.next === undefined) &&
      published?.gitHead === sha &&
      published?.dist?.attestations?.url
    ) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  }
  throw new Error(`${name}@${version} did not become fully visible in npm within ${timeoutMs} ms`);
}

async function finalizeRelease() {
  const sha = currentSha();
  for (const { name } of publicPackages) {
    const packument = await registryPackage(name);
    const published = packument?.versions?.[version];
    if (packument?.['dist-tags']?.[channel] !== version) {
      throw new Error(`${name} ${channel} does not resolve to ${version}`);
    }
    if (packument?.['dist-tags']?.alpha !== '0.5.0-alpha.3') {
      throw new Error(`${name} alpha does not resolve to 0.5.0-alpha.3`);
    }
    if (channel === 'latest' && packument?.['dist-tags']?.next !== undefined) {
      throw new Error(`${name} still has a next dist-tag`);
    }
    if (published?.gitHead !== sha) {
      throw new Error(`${name}@${version} gitHead does not match ${sha}`);
    }
    if (!published.dist?.attestations?.url) {
      throw new Error(`${name}@${version} has no npm provenance attestation`);
    }
  }

  const root = await mkdtemp(join(tmpdir(), 'resvary-finalize-smoke-'));
  try {
    const dependencies = Object.fromEntries(publicPackages.map(({ name }) => [name, version]));
    dependencies.typescript = '5.9.3';
    await writeFile(
      join(root, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module', dependencies }, null, 2)}\n`,
      'utf8',
    );
    run('npm', ['install', '--no-audit', '--no-fund'], { cwd: root });
    run('npm', ['audit', 'signatures'], { cwd: root });
    for (const { name } of publicPackages) {
      const installed = JSON.parse(
        await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'),
      );
      if (installed.version !== version) {
        throw new Error(`${name} latest installed ${installed.version}; expected ${version}`);
      }
    }
    await writeRegistryChecks(root);
    run(process.execPath, ['check.mjs'], { cwd: root });
    run('npm', ['exec', '--', 'tsc', '--noEmit', '--project', 'tsconfig.json'], { cwd: root });
    for (const packageInfo of publicPackages.filter(({ cli }) => cli)) {
      run(
        process.execPath,
        [join(root, 'node_modules', packageInfo.name, packageInfo.cli), '--help'],
        { cwd: root, env: { DATABASE_URL: '', RESVARY_WEBHOOK_SECRET: '' } },
      );
    }
    await buildStarters(root);
    run('npm', ['exec', '--yes', `create-resvary@${version}`, '--', '--help'], { cwd: root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('Final registry, provenance, install, export, CLI, and starter checks passed.');
}

async function writeRegistryChecks(root) {
  await writeFile(
    join(root, 'check.mjs'),
    `const checks = ${JSON.stringify([
      ['@resvary/sdk', 'CreditLedger'],
      ['@resvary/sdk/credits', 'InMemoryCreditStore'],
      ['@resvary/sdk/receipts', 'PersistentReceiptLedger'],
      ['@resvary/sdk/admin', 'OperatorService'],
      ['@resvary/sqlite', 'createSqliteCreditStore'],
      ['@resvary/sqlite/admin', 'createSqliteAdminStore'],
      ['@resvary/circle', 'GatewayNanopaymentFunding'],
      ['@resvary/postgres', 'createPostgresCreditStore'],
      ['@resvary/postgres/admin', 'createPostgresAdminStore'],
      ['@resvary/worker', 'OutboxWorker'],
    ])};\nfor (const [specifier, name] of checks) { const module = await import(specifier); if (typeof module[name] !== 'function') throw new Error(\`${'${specifier}'} missing ${'${name}'}\`); }\n`,
    'utf8',
  );
  await writeFile(
    join(root, 'check.ts'),
    `import { BuyerClient, CreditLedger, type CreditGrantPolicy, type CreditLot, type CreditPolicyStore } from '@resvary/sdk';\nimport { type ArcCreditFundingConfig } from '@resvary/sdk/funding/arc';\nconst funding: Pick<ArcCreditFundingConfig, 'rpcUrl' | 'publicClient'> = {};\nvoid BuyerClient; void CreditLedger; void funding;\nconst policy = null as unknown as CreditGrantPolicy;\nconst lot = null as unknown as CreditLot;\nconst store = null as unknown as CreditPolicyStore;\nvoid policy; void lot; void store;\n`,
    'utf8',
  );
  await writeFile(
    join(root, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['check.ts'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function buildStarters(root) {
  const starterRoot = join(root, 'starters');
  const generatorPath = join(root, 'node_modules/create-resvary/dist/generator.js');
  const variants = [
    { projectName: 'express-sqlite', framework: 'express', database: 'sqlite' },
    { projectName: 'express-postgres', framework: 'express', database: 'postgres' },
    { projectName: 'next-sqlite', framework: 'next', database: 'sqlite' },
    { projectName: 'next-postgres', framework: 'next', database: 'postgres' },
  ];
  const source = `import { mkdir } from 'node:fs/promises';\nimport { generateProject } from ${JSON.stringify(pathToFileURL(generatorPath).href)};\nawait mkdir(${JSON.stringify(starterRoot)}, { recursive: true });\nprocess.chdir(${JSON.stringify(starterRoot)});\nfor (const variant of ${JSON.stringify(variants)}) await generateProject({ ...variant, template: 'ai-credits', pricing: 'request', payTo: '0x0000000000000000000000000000000000000000' });\n`;
  await writeFile(join(root, 'generate-starters.mjs'), source, 'utf8');
  run(process.execPath, ['generate-starters.mjs'], { cwd: root });
  for (const variant of variants) {
    const directory = join(starterRoot, variant.projectName);
    run('npm', ['install', '--no-audit', '--no-fund'], { cwd: directory });
    run('npm', ['run', 'build'], { cwd: directory });
  }
}

async function createGitHubRelease() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error('GitHub release credentials are missing');
  const sha = currentSha();
  const tag = `v${version}`;
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  };
  const api = `https://api.github.com/repos/${repository}`;
  const existingRef = await fetch(`${api}/git/ref/tags/${tag}`, { headers });
  if (existingRef.ok) {
    const body = await existingRef.json();
    if (body.object?.type !== 'tag') throw new Error(`${tag} exists but is not annotated`);
    const tagResponse = await fetch(body.object.url, { headers });
    const tagObject = await tagResponse.json();
    if (tagObject.object?.sha !== sha) throw new Error(`${tag} does not point to ${sha}`);
  } else if (existingRef.status === 404) {
    const tagObject = await githubRequest(`${api}/git/tags`, headers, {
      tag,
      message: `Resvary ${version}`,
      object: sha,
      type: 'commit',
    });
    await githubRequest(`${api}/git/refs`, headers, {
      ref: `refs/tags/${tag}`,
      sha: tagObject.sha,
    });
  } else {
    throw new Error(`Could not inspect ${tag}: GitHub returned ${existingRef.status}`);
  }

  const changelog = await readFile(resolve('CHANGELOG.md'), 'utf8');
  const changelogVersion = version.split('-')[0];
  const escaped = changelogVersion.replaceAll('.', '\\.');
  const match = changelog.match(
    new RegExp(`## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[)`),
  );
  if (!match) throw new Error(`Could not extract CHANGELOG section for ${changelogVersion}`);
  const releaseResponse = await fetch(`${api}/releases/tags/${tag}`, { headers });
  if (releaseResponse.status === 404) {
    await githubRequest(`${api}/releases`, headers, {
      tag_name: tag,
      target_commitish: sha,
      name: `Resvary ${version}`,
      body: match[1].trim(),
      draft: false,
      prerelease: channel === 'next',
    });
  } else if (!releaseResponse.ok) {
    throw new Error(`Could not inspect GitHub Release: ${releaseResponse.status}`);
  }
}

async function githubRequest(url, headers, body) {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) {
    throw new Error(`GitHub API ${url} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}
