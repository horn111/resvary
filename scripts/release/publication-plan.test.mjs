import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPublicationPlan } from './publication-plan.mjs';

const releaseSha = 'a'.repeat(40);
const publishLevels = [['sdk'], ['sqlite', 'postgres', 'circle'], ['worker'], ['create']];
const names = publishLevels.flat();

function state(name, { latest = '0.7.0', next, published = null, version = '0.8.0' } = {}) {
  return {
    name,
    packument: {
      'dist-tags': { alpha: '0.5.0-alpha.3', latest, ...(next ? { next } : {}) },
      versions: published ? { [version]: published } : {},
    },
  };
}

function matchingPublished() {
  return { gitHead: releaseSha, dist: { attestations: { url: 'https://registry.example/a' } } };
}

test('publishes a synchronized package set in dependency order', () => {
  const plan = createPublicationPlan({
    version: '0.8.0',
    releaseSha,
    packageStates: names.map((name) => state(name)),
    publishLevels,
  });

  assert.equal(plan.previousLatest, '0.7.0');
  assert.equal(plan.channel, 'latest');
  assert.deepEqual(
    plan.levels,
    publishLevels.map((level) => level.map((name) => ({ name, action: 'publish' }))),
  );
});

test('publishes prereleases to next without moving latest', () => {
  const plan = createPublicationPlan({
    version: '1.0.0-rc.1',
    releaseSha,
    packageStates: names.map((name) => state(name, { latest: '0.8.0' })),
    publishLevels,
  });

  assert.equal(plan.previousLatest, '0.8.0');
  assert.equal(plan.channel, 'next');
  assert.ok(plan.levels.flat().every(({ action }) => action === 'publish'));
});

test('advances next from an older release candidate', () => {
  const plan = createPublicationPlan({
    version: '1.0.0-rc.2',
    releaseSha,
    packageStates: names.map((name) =>
      state(name, { latest: '0.8.0', next: '1.0.0-rc.1' }),
    ),
    publishLevels,
  });

  assert.equal(plan.channel, 'next');
});

test('safely resumes an existing prerelease with provenance', () => {
  const plan = createPublicationPlan({
    version: '1.0.0-rc.1',
    releaseSha,
    packageStates: names.map((name, index) =>
      index === 0
        ? state(name, {
            latest: '0.8.0',
            next: '1.0.0-rc.1',
            published: matchingPublished(),
            version: '1.0.0-rc.1',
          })
        : state(name, { latest: '0.8.0' }),
    ),
    publishLevels,
  });

  assert.equal(plan.levels[0][0].action, 'skip');
  assert.equal(plan.channel, 'next');
});

test('rejects an older or equal prerelease channel', () => {
  assert.throws(
    () =>
      createPublicationPlan({
        version: '1.0.0-rc.1',
        releaseSha,
        packageStates: names.map((name) =>
          state(name, { latest: '0.8.0', next: '1.0.0-rc.2' }),
        ),
        publishLevels,
      }),
    /is not older than prerelease/,
  );
});

test('safely resumes a partial publication with matching provenance', () => {
  const packageStates = names.map((name, index) =>
    index < 2 ? state(name, { latest: '0.8.0', published: matchingPublished() }) : state(name),
  );
  const plan = createPublicationPlan({
    version: '0.8.0',
    releaseSha,
    packageStates,
    publishLevels,
  });

  assert.equal(plan.levels[0][0].action, 'skip');
  assert.equal(plan.levels[1][0].action, 'skip');
  assert.equal(plan.levels[1][1].action, 'publish');
  assert.equal(plan.previousLatest, '0.7.0');
});

test('rejects an existing version from another commit', () => {
  const packageStates = names.map((name, index) =>
    index === 0
      ? state(name, {
          latest: '0.8.0',
          published: { ...matchingPublished(), gitHead: 'b'.repeat(40) },
        })
      : state(name),
  );

  assert.throws(
    () =>
      createPublicationPlan({
        version: '0.8.0',
        releaseSha,
        packageStates,
        publishLevels,
      }),
    /expected a{40}/,
  );
});

test('rejects divergent previous latest tags', () => {
  const packageStates = names.map((name, index) =>
    state(name, { latest: index === 0 ? '0.6.1' : '0.7.0' }),
  );

  assert.throws(
    () =>
      createPublicationPlan({
        version: '0.8.0',
        releaseSha,
        packageStates,
        publishLevels,
      }),
    /do not share one previous latest/,
  );
});

test('release workflow uses one protected direct-publish job', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /options: \[dry_run, publish\]/);
  assert.match(workflow, /environment: Production/);
  assert.equal(workflow.match(/environment: Production/g)?.length, 1);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /registry\.mjs publish/);
  assert.match(workflow, /1\.0\.0-rc\.1/);
  assert.doesNotMatch(workflow, /npm stage|stage-receipt|inputs\.mode == 'stage'/);
});

test('release Docker context excludes generated build state', async () => {
  const dockerignore = await readFile(new URL('../../.dockerignore', import.meta.url), 'utf8');

  assert.match(dockerignore, /^\.resvary$/m);
  assert.match(dockerignore, /^\*\*\/\*\.tsbuildinfo$/m);
});
