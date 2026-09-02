import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  assertStableVersion,
  currentSha,
  publicPackages,
  readJson,
  repositoryRoot,
  run,
} from './common.mjs';

const mode = process.argv[2];
const version = process.argv[3];
assertStableVersion(version);
const artifactDirectory = resolve(
  process.env.RELEASE_ARTIFACT_DIR ?? join(tmpdir(), 'resvary-release-artifacts'),
);

if (mode === 'pack') await packArtifacts();
else if (mode === 'smoke') await smokeArtifacts();
else throw new Error('Usage: node scripts/release/artifacts.mjs <pack|smoke> <version>');

async function packArtifacts() {
  await rm(artifactDirectory, { recursive: true, force: true });
  await mkdir(artifactDirectory, { recursive: true });
  const manifest = { version, packages: [] };
  const gitHead = currentSha();

  for (const packageInfo of publicPackages) {
    const packageDirectory = resolve(repositoryRoot, packageInfo.directory);
    const packageJsonPath = join(packageDirectory, 'package.json');
    const originalPackageJson = await readFile(packageJsonPath, 'utf8');
    const packageManifest = await readJson(`${packageInfo.directory}/package.json`);
    if (packageManifest.version !== version) {
      throw new Error(`${packageInfo.name} is not version ${version}`);
    }
    await writeFile(
      packageJsonPath,
      `${JSON.stringify({ ...packageManifest, gitHead }, null, 2)}\n`,
      'utf8',
    );
    let output;
    try {
      output = run(
        'npm',
        ['pack', packageDirectory, '--json', '--silent', '--pack-destination', artifactDirectory],
        { capture: true },
      );
    } finally {
      await writeFile(packageJsonPath, originalPackageJson, 'utf8');
    }
    const packed = JSON.parse(output)[0];
    if (!packed?.filename || !Array.isArray(packed.files)) {
      throw new Error(`npm pack returned invalid metadata for ${packageInfo.name}`);
    }
    const archivePath = join(artifactDirectory, packed.filename);
    await access(archivePath);
    validateFileList(
      packageInfo.name,
      packed.files.map(({ path }) => path),
    );
    await inspectArchive(packageInfo, archivePath, gitHead);
    const bytes = await readFile(archivePath);
    manifest.packages.push({
      name: packageInfo.name,
      version,
      gitHead,
      file: packed.filename,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    });
  }

  await writeFile(
    join(artifactDirectory, 'sha256-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  console.log(`Packed and validated ${manifest.packages.length} release archives.`);
}

function validateFileList(name, files) {
  if (!files.includes('package.json') || !files.some((path) => path.startsWith('dist/'))) {
    throw new Error(`${name} archive is missing package.json or dist output`);
  }
  const forbidden = files.filter((path) =>
    /(^|\/)(?:\.env(?:\.|$)|src|test|tests|docs\/evidence|\.github|\.git)(?:\/|$)/i.test(path),
  );
  if (forbidden.length > 0) {
    throw new Error(`${name} archive contains internal files: ${forbidden.join(', ')}`);
  }
}

async function inspectArchive(packageInfo, archivePath, gitHead) {
  const extractionRoot = await mkdtemp(join(tmpdir(), 'resvary-pack-'));
  try {
    run('tar', ['-xzf', archivePath, '-C', extractionRoot]);
    const packageRoot = join(extractionRoot, 'package');
    const packedManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    if (
      packedManifest.name !== packageInfo.name ||
      packedManifest.version !== version ||
      packedManifest.gitHead !== gitHead ||
      packedManifest.repository?.type !== 'git' ||
      packedManifest.repository?.url !== 'git+https://github.com/horn111/resvary.git' ||
      packedManifest.repository?.directory !== packageInfo.directory
    ) {
      throw new Error(`${packageInfo.name} archive metadata does not match the release commit`);
    }
    if (packageInfo.cli) {
      const source = await readFile(join(packageRoot, packageInfo.cli), 'utf8');
      if (!source.startsWith('#!/usr/bin/env node')) {
        throw new Error(`${packageInfo.name} CLI is missing its Node.js shebang`);
      }
    }
    const files = await walk(packageRoot);
    const secretPattern =
      /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,})|(?:PRIVATE_KEY|NPM_TOKEN)\s*=\s*[^\s'"<]+/;
    for (const file of files) {
      const fileStat = await stat(file);
      if (fileStat.size > 1_000_000) continue;
      const content = await readFile(file, 'utf8').catch(() => '');
      if (secretPattern.test(content)) {
        throw new Error(`${packageInfo.name} archive contains a secret-like value in ${file}`);
      }
    }
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

async function smokeArtifacts() {
  const manifest = JSON.parse(
    await readFile(join(artifactDirectory, 'sha256-manifest.json'), 'utf8'),
  );
  if (manifest.version !== version || manifest.packages.length !== publicPackages.length) {
    throw new Error('Release artifact manifest is incomplete or has the wrong version');
  }
  if (manifest.packages.some((entry) => entry.gitHead !== currentSha())) {
    throw new Error('Release artifacts do not match the current release commit');
  }
  for (const entry of manifest.packages) {
    const bytes = await readFile(join(artifactDirectory, entry.file));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== entry.sha256) throw new Error(`SHA-256 mismatch for ${entry.file}`);
  }

  const smokeRoot = await mkdtemp(join(tmpdir(), 'resvary-artifact-smoke-'));
  try {
    const dependencies = Object.fromEntries(
      manifest.packages.map((entry) => [entry.name, `file:${join(artifactDirectory, entry.file)}`]),
    );
    dependencies.typescript = '5.9.3';
    await writeFile(
      join(smokeRoot, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module', dependencies }, null, 2)}\n`,
      'utf8',
    );
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: smokeRoot });
    await writeSmokeSources(smokeRoot);
    run(process.execPath, ['check.mjs'], { cwd: smokeRoot });
    run('npm', ['exec', '--', 'tsc', '--noEmit', '--project', 'tsconfig.json'], { cwd: smokeRoot });
    for (const packageInfo of publicPackages.filter(({ cli }) => cli)) {
      const cli = join(smokeRoot, 'node_modules', packageInfo.name, packageInfo.cli);
      run(process.execPath, [cli, '--help'], {
        cwd: smokeRoot,
        env: { DATABASE_URL: '', RESVARY_WEBHOOK_SECRET: '' },
      });
    }
  } finally {
    await rm(smokeRoot, { recursive: true, force: true });
  }
  console.log('Independent tarball install, JS/type exports, and CLI smoke tests passed.');
}

async function writeSmokeSources(root) {
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
    `import { BuyerClient, type BuyerPaymentPolicy, type BuyerPaymentProposal, type CreateAdvancedPriceVersionInput, type GraduatedPriceComponentInput, type GraduatedPriceTierInput, type PackagePriceComponentInput, type PriceComponent, type PriceComponentInput } from '@resvary/sdk';\nimport { type ArcCreditFundingConfig } from '@resvary/sdk/funding/arc';\nconst policy: BuyerPaymentPolicy = { maxAmount: '1', maxTotalAmount: '2', allowedPayTo: ['0x0000000000000000000000000000000000000000'] };\nconst approve = (_proposal: BuyerPaymentProposal) => true;\nconst funding: Pick<ArcCreditFundingConfig, 'rpcUrl' | 'publicClient'> = {};\nconst tier: GraduatedPriceTierInput = { upTo: '1000', unitSize: '1000', amount: '0.001' };\nconst graduated: GraduatedPriceComponentInput = { model: 'graduated', dimension: 'tokens', tiers: [tier, { unitSize: '1000', amount: '0.0005' }] };\nconst bundled: PackagePriceComponentInput = { model: 'package', dimension: 'images', packageSize: '10', amount: '1' };\nconst componentInputs: PriceComponentInput[] = [graduated, bundled];\nconst advanced: CreateAdvancedPriceVersionInput = { meterKey: 'usage', components: componentInputs, idempotencyKey: 'price-v2' };\nconst storedComponents: PriceComponent[] = [];\nvoid BuyerClient; void policy; void approve; void funding; void advanced; void storedComponents;\n`,
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
