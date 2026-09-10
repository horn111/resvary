import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportCircleSession } from '../src/lib/circle-session';

// Run after an operator completes `circle wallet login EMAIL --testnet`.
// Credentials stay in a Git-ignored env file. Do not print or pipe its contents.
async function main() {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const destination = join(repository, '.env.circle-session.local');
  const cliHome = process.env.CIRCLE_CLI_HOME ?? join(homedir(), '.circle-cli');
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', destination], {
      cwd: repository,
      stdio: 'ignore',
    });
  } catch {
    throw new Error('Circle session export destination must be ignored by Git');
  }
  let session: unknown;
  let terms: unknown;
  try {
    session = JSON.parse(
      await readFile(join(cliHome, 'profiles', 'agent', 'session.json'), 'utf8'),
    );
    terms = JSON.parse(await readFile(join(cliHome, 'terms.json'), 'utf8'));
  } catch {
    throw new Error(
      'Cannot read a completed CLI login and Terms acceptance; log in on Testnet first',
    );
  }
  const encryptionKey = randomBytes(32).toString('hex');
  const bundle = exportCircleSession(session, terms, encryptionKey);
  try {
    await writeFile(
      destination,
      [
        '# PRIVATE: upload these two values only as server-side Sensitive environment variables.',
        '# Never use NEXT_PUBLIC_ prefixes or publish this file.',
        `# Testnet session expires at ${new Date(bundle.expiresAt).toISOString()}.`,
        `CIRCLE_AGENT_SESSION_BUNDLE=${bundle.encrypted}`,
        `CIRCLE_SESSION_ENCRYPTION_KEY=${encryptionKey}`,
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(
        'Private export file already exists; move the old export before replacing it',
      );
    throw new Error('Cannot write the private Circle session export');
  }
  console.log(`Circle Testnet export saved to ${destination}`);
  console.log(
    `Expires at ${new Date(bundle.expiresAt).toISOString()}. No credential values were printed.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Circle session export failed');
  process.exitCode = 1;
});
