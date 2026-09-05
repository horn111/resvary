const releaseVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

export function createPublicationPlan({
  version,
  releaseSha,
  packageStates,
  publishLevels,
  alphaVersion = '0.5.0-alpha.3',
}) {
  if (!releaseVersionPattern.test(version)) throw new Error(`Invalid release version ${version}`);
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) throw new Error('releaseSha must be a full commit SHA');

  const channel = version.includes('-') ? 'next' : 'latest';

  const expectedNames = publishLevels.flat();
  if (new Set(expectedNames).size !== expectedNames.length) {
    throw new Error('Publish levels contain duplicate package names');
  }
  const states = new Map(packageStates.map((state) => [state.name, state]));
  if (states.size !== packageStates.length || states.size !== expectedNames.length) {
    throw new Error('Package registry state does not match the configured publish levels');
  }
  for (const name of expectedNames) {
    if (!states.has(name)) throw new Error(`Missing registry state for ${name}`);
  }

  const previousLatest = new Set();
  const actions = new Map();
  for (const name of expectedNames) {
    const packument = states.get(name)?.packument;
    if (!packument) throw new Error(`${name} does not exist in npm`);
    const tags = packument['dist-tags'] ?? {};
    if (tags.alpha !== alphaVersion) {
      throw new Error(`${name} alpha must resolve to ${alphaVersion}`);
    }
    const published = packument.versions?.[version];
    if (published) {
      if (published.gitHead !== releaseSha) {
        throw new Error(
          `${name}@${version} has gitHead ${published.gitHead ?? '<missing>'}, expected ${releaseSha}`,
        );
      }
      if (tags[channel] !== version) {
        throw new Error(`${name}@${version} is public but ${channel} does not resolve to it`);
      }
      if (!published.dist?.attestations?.url) {
        throw new Error(`${name}@${version} is public without npm provenance`);
      }
      actions.set(name, 'skip');
      continue;
    }

    if (!/^\d+\.\d+\.\d+$/.test(tags.latest ?? '')) {
      throw new Error(`${name} latest is missing or is not a stable version`);
    }
    if (compareVersions(version.split('-')[0], tags.latest) <= 0) {
      throw new Error(`${name} latest ${tags.latest} is not older than release ${version}`);
    }
    if (channel === 'next' && tags.next && compareVersions(version, tags.next) <= 0) {
      throw new Error(`${name} next ${tags.next} is not older than prerelease ${version}`);
    }
    previousLatest.add(tags.latest);
    actions.set(name, 'publish');
  }

  if (previousLatest.size > 1) {
    throw new Error(
      `Unpublished packages do not share one previous latest: ${[...previousLatest].join(', ')}`,
    );
  }

  return {
    previousLatest: previousLatest.values().next().value ?? null,
    channel,
    levels: publishLevels.map((level) =>
      level.map((name) => ({ name, action: actions.get(name) })),
    ),
  };
}

function compareVersions(left, right) {
  const [leftCore, leftPre = ''] = left.split('-', 2);
  const [rightCore, rightPre = ''] = right.split('-', 2);
  const leftParts = leftCore.split('.').map(Number);
  const rightParts = rightCore.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  if (!leftPre && rightPre) return 1;
  if (leftPre && !rightPre) return -1;
  return leftPre.localeCompare(rightPre, undefined, { numeric: true });
}
