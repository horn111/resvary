import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(new URL('../../apps/agent-demo/package.json', import.meta.url));
const cli = require.resolve('@circle-fin/cli');
const cliRequire = createRequire(cli);
const anchorRequire = createRequire(cliRequire.resolve('@coral-xyz/anchor'));
const toml = anchorRequire('toml');

test('Circle CLI resolves the reviewed patched TOML through Anchor', () => {
  assert.equal(anchorRequire('toml/package.json').version, '4.3.0');
});

test('Anchor can read its Buffer-based workspace configuration with patched TOML', () => {
  const root = mkdtempSync(join(tmpdir(), 'resvary-anchor-toml-'));
  const previousDirectory = process.cwd();
  const address = '11111111111111111111111111111111';
  try {
    writeFileSync(
      join(root, 'Anchor.toml'),
      `[provider]\ncluster = "localnet"\n[programs.localnet]\nresvary_toml_compat = { address = "${address}", idl = "fixture.json" }\n`,
    );
    writeFileSync(
      join(root, 'fixture.json'),
      JSON.stringify({
        address,
        metadata: { name: 'resvary_toml_compat', version: '0.1.0', spec: '0.1.0' },
        instructions: [],
      }),
    );
    process.chdir(root);
    const anchor = cliRequire('@coral-xyz/anchor');
    // Program construction must not require a wallet, session, or network request.
    anchor.setProvider({ connection: {} });
    assert.equal(anchor.workspace.resvaryTomlCompat.programId.toBase58(), address);
  } finally {
    process.chdir(previousDirectory);
    rmSync(root, { recursive: true, force: true });
  }
});

test('TOML rejects deep arrays and inline tables before overflowing the stack', () => {
  for (const input of [
    `value=${'['.repeat(3000)}1${']'.repeat(3000)}`,
    `value=${'{inner='.repeat(3000)}1${'}'.repeat(3000)}`,
  ]) {
    assert.throws(
      () => toml.parse(input),
      (error) => !(error instanceof RangeError) && /nesting depth/i.test(error.message),
    );
  }
  assert.equal(toml.parse('value=7').value, 7);
});

test('TOML rejects scalar-to-prototype traversal without polluting objects', () => {
  for (const input of [
    '[first.second]\nvalue=1\n[first.second.value.__proto__.__proto__]\nresvaryTomlProbe="bad"',
    'scalar=1\n[[entries]]\n[scalar.__proto__.__proto__]\nresvaryTomlProbe="bad"',
  ]) {
    try {
      assert.throws(() => toml.parse(input));
      assert.equal(Object.hasOwn(Object.prototype, 'resvaryTomlProbe'), false);
      assert.equal({}.resvaryTomlProbe, undefined);
    } finally {
      delete Object.prototype.resvaryTomlProbe;
    }
  }
});

test('Circle CLI loads wallet, Gateway and payment commands without credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'resvary-circle-help-'));
  try {
    const env = { ...process.env, HOME: root, USERPROFILE: root, DO_NOT_TRACK: '1' };
    for (const args of [
      ['--version'],
      ['wallet', 'status', '--help'],
      ['wallet', 'list', '--help'],
      ['gateway', 'balance', '--help'],
      ['services', 'pay', '--help'],
    ]) {
      const output = execFileSync(process.execPath, [cli, ...args], {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 256_000,
        windowsHide: true,
      });
      assert.ok(output.trim(), `No output for ${args.join(' ')}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
