import { version } from '../../../../package.json';

export function buildInfo() {
  const commit = process.env.RESVARY_BUILD_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  return { version, commit: /^[a-f0-9]{40}$/.test(commit) ? commit : null };
}
