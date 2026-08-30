import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertStableVersion,
  currentSha,
  publicPackages,
  publishLevels,
  registryPackage,
  run,
  waitForVersion,
} from './common.mjs';

const command = process.argv[2];
const version = process.argv[3];
assertStableVersion(version);
const artifactDirectory = resolve(
  process.env.RELEASE_ARTIFACT_DIR ?? join(tmpdir(), 'resvary-release-artifacts'),
);

if (command === 'publish') await publishNext();
else if (command === 'smoke') await smokeRegistry();
else if (command === 'promote') await promote();
else if (command === 'post-smoke') await postPromotionSmoke();
else if (command === 'github-release') await createGitHubRelease();
else
  throw new Error(
    'Usage: registry.mjs <publish|smoke|promote|post-smoke|github-release> <version>',
  );

async function loadArtifactManifest() {
  const path = join(artifactDirectory, 'sha256-manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest.version !== version || manifest.packages.length !== publicPackages.length) {
    throw new Error('Release artifact manifest is incomplete or has the wrong version');
  }
  if (manifest.packages.some((entry) => entry.gitHead !== currentSha())) {
    throw new Error('Release artifacts do not match the current release commit');
  }
  for (const entry of manifest.packages) {
    const bytes = await readFile(join(artifactDirectory, entry.file));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== entry.sha256) throw new Error(`SHA-256 mismatch for ${entry.file}`);
  }
  return manifest;
}

async function publishNext() {
  if (!process.env.NODE_AUTH_TOKEN) throw new Error('NODE_AUTH_TOKEN is required for npm publish');
  const manifest = await loadArtifactManifest();
  const sha = currentSha();
  const artifacts = new Map(manifest.packages.map((entry) => [entry.name, entry]));

  for (const level of publishLevels) {
    for (const name of level) {
      const existing = (await registryPackage(name))?.versions?.[version];
      if (existing) {
        if (existing.gitHead !== sha) {
          throw new Error(
            `${name}@${version} exists with gitHead ${existing.gitHead ?? '<missing>'}, expected ${sha}`,
          );
        }
        console.log(`Skipping ${name}@${version}; matching release SHA is already published.`);
        if ((await registryPackage(name))?.['dist-tags']?.next !== version) {
          run('npm', ['dist-tag', 'add', `${name}@${version}`, 'next']);
        }
        continue;
      }
      const artifact = artifacts.get(name);
      if (!artifact) throw new Error(`No checked artifact found for ${name}`);
      run('npm', [
        'publish',
        join(artifactDirectory, artifact.file),
        '--tag',
        'next',
        '--access',
        'public',
        '--provenance',
      ]);
    }
    for (const name of level) {
      const published = await waitForVersion(name, version);
      if (published.gitHead !== sha) {
        throw new Error(
          `${name}@${version} became visible with gitHead ${published.gitHead ?? '<missing>'}, expected ${sha}`,
        );
      }
    }
  }
}

async function smokeRegistry() {
  const sha = currentSha();
  for (const { name } of publicPackages) {
    const packument = await registryPackage(name);
    const published = packument?.versions?.[version];
    if (!published || published.gitHead !== sha) {
      throw new Error(`${name}@${version} is missing or does not match release SHA ${sha}`);
    }
    if (!published.dist?.attestations?.url) {
      throw new Error(`${name}@${version} does not expose an npm provenance attestation`);
    }
    if (packument['dist-tags']?.latest !== '0.5.0') {
      throw new Error(`${name} latest changed before approval: ${packument['dist-tags']?.latest}`);
    }
    if (packument['dist-tags']?.next !== version) {
      throw new Error(`${name} next is ${packument['dist-tags']?.next}; expected ${version}`);
    }
    if (packument['dist-tags']?.alpha !== '0.5.0-alpha.3') {
      throw new Error(`${name} alpha must remain 0.5.0-alpha.3`);
    }
  }

  const root = await mkdtemp(join(tmpdir(), 'resvary-registry-smoke-'));
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
    await writeRegistryChecks(root);
    run(process.execPath, ['check.mjs'], { cwd: root });
    run('npm', ['exec', '--', 'tsc', '--noEmit', '--project', 'tsconfig.json'], { cwd: root });
    for (const packageInfo of publicPackages.filter(({ cli }) => cli)) {
      run(
        process.execPath,
        [join(root, 'node_modules', packageInfo.name, packageInfo.cli), '--help'],
        {
          cwd: root,
          env: { DATABASE_URL: '', RESVARY_WEBHOOK_SECRET: '' },
        },
      );
    }
    await buildStarters(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('Registry smoke passed for exact packages, types, CLIs, and four starters.');
}

async function writeRegistryChecks(root) {
  await writeFile(
    join(root, 'check.mjs'),
    `const checks = ${JSON.stringify([
      ['@resvary/sdk', 'CreditLedger'],
      ['@resvary/sdk/credits', 'InMemoryCreditStore'],
      ['@resvary/sdk/receipts', 'PersistentReceiptLedger'],
      ['@resvary/sqlite', 'createSqliteCreditStore'],
      ['@resvary/circle', 'GatewayNanopaymentFunding'],
      ['@resvary/postgres', 'createPostgresCreditStore'],
      ['@resvary/worker', 'OutboxWorker'],
    ])};\nfor (const [specifier, name] of checks) { const module = await import(specifier); if (typeof module[name] !== 'function') throw new Error(\`${'${specifier}'} missing ${'${name}'}\`); }\n`,
    'utf8',
  );
  await writeFile(
    join(root, 'check.ts'),
    `import { BuyerClient, type BuyerPaymentPolicy, type BuyerPaymentProposal } from '@resvary/sdk';\nimport { type ArcCreditFundingConfig } from '@resvary/sdk/funding/arc';\nconst policy: BuyerPaymentPolicy = { maxAmount: '1', maxTotalAmount: '2', allowedPayTo: ['0x0000000000000000000000000000000000000000'] };\nconst approve = (_proposal: BuyerPaymentProposal) => true;\nconst funding: Pick<ArcCreditFundingConfig, 'rpcUrl' | 'publicClient'> = {};\nvoid BuyerClient; void policy; void approve; void funding;\n`,
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

async function promote() {
  if (!process.env.NODE_AUTH_TOKEN) throw new Error('NODE_AUTH_TOKEN is required for promotion');
  const snapshots = new Map();
  const changed = [];
  for (const { name } of publicPackages) {
    const packument = await registryPackage(name);
    const latest = packument?.['dist-tags']?.latest;
    if (latest !== '0.5.0' && latest !== version) {
      throw new Error(`${name} latest is ${latest}; expected 0.5.0 before promotion`);
    }
    snapshots.set(name, latest);
  }

  try {
    for (const { name } of publicPackages) {
      run('npm', ['dist-tag', 'add', `${name}@${version}`, 'latest']);
      changed.push(name);
    }
    for (const { name } of publicPackages) {
      await waitForTag(name, 'latest', version);
    }
  } catch (error) {
    for (const name of changed.reverse()) {
      const previous = snapshots.get(name);
      if (previous) {
        run('npm', ['dist-tag', 'add', `${name}@${previous}`, 'latest'], { allowFailure: true });
      }
    }
    throw error;
  }

  for (const { name } of publicPackages) {
    run('npm', ['dist-tag', 'add', `${name}@0.5.0-alpha.3`, 'alpha']);
    run('npm', ['dist-tag', 'rm', name, 'next'], { allowFailure: true });
  }
  for (const { name } of publicPackages) {
    await waitForTag(name, 'latest', version);
    await waitForTag(name, 'alpha', '0.5.0-alpha.3');
    await waitForTag(name, 'next', undefined);
  }
}

async function waitForTag(name, tag, expected, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const actual = (await registryPackage(name))?.['dist-tags']?.[tag];
    if (actual === expected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000));
  }
  throw new Error(`${name} dist-tag ${tag} did not converge to ${expected ?? '<absent>'}`);
}

async function postPromotionSmoke() {
  const sha = currentSha();
  for (const { name } of publicPackages) {
    const packument = await registryPackage(name);
    const published = packument?.versions?.[version];
    if (packument?.['dist-tags']?.latest !== version) {
      throw new Error(`${name} latest does not resolve to ${version}`);
    }
    if (packument?.['dist-tags']?.alpha !== '0.5.0-alpha.3') {
      throw new Error(`${name} alpha does not resolve to 0.5.0-alpha.3`);
    }
    if (packument?.['dist-tags']?.next !== undefined) {
      throw new Error(`${name} still has a next dist-tag`);
    }
    if (published?.gitHead !== sha || !published.dist?.attestations?.url) {
      throw new Error(`${name}@${version} metadata or provenance does not match ${sha}`);
    }
  }

  const root = await mkdtemp(join(tmpdir(), 'resvary-latest-smoke-'));
  try {
    const dependencies = Object.fromEntries(publicPackages.map(({ name }) => [name, 'latest']));
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
        throw new Error(`${name} installed without a version resolved to ${installed.version}`);
      }
    }
    run('npm', ['exec', '--yes', `create-resvary@${version}`, '--', '--help'], { cwd: root });
  } finally {
    await rm(root, { recursive: true, force: true });
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
  const escaped = version.replaceAll('.', '\\.');
  const match = changelog.match(
    new RegExp(`## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[)`),
  );
  if (!match) throw new Error(`Could not extract CHANGELOG section for ${version}`);
  const notes = match[1].trim();
  const releaseResponse = await fetch(`${api}/releases/tags/${tag}`, { headers });
  if (releaseResponse.status === 404) {
    await githubRequest(`${api}/releases`, headers, {
      tag_name: tag,
      target_commitish: sha,
      name: `Resvary ${version}`,
      body: notes,
      draft: false,
      prerelease: false,
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
