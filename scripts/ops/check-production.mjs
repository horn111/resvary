const targets = [
  ['Agent Demo', 'https://agent.resvary.xyz/api/health', true],
  ['Marketing site', 'https://www.resvary.xyz/api/version', false],
];

let failed = false;
for (const [name, url, health] of targets) {
  let passed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const data = await response.json();
      const build = health ? data.build : data;
      if (
        !response.ok ||
        (health && (data.ok !== true || !Array.isArray(data.issues) || data.issues.length))
      ) {
        const issues = Array.isArray(data.issues)
          ? data.issues.filter((value) => /^[a-z_]+$/.test(value)).join(', ')
          : 'unavailable';
        throw new Error(`HTTP ${response.status}; issues: ${issues}`);
      }
      if (
        !/^[a-f0-9]{40}$/.test(build?.commit ?? '') ||
        !/^\d+\.\d+\.\d+$/.test(build?.version ?? '')
      )
        throw new Error('Missing deployment identity');
      console.log(`${name}: ${build.version} ${build.commit}`);
      passed = true;
      break;
    } catch (error) {
      if (attempt === 2)
        console.error(`${name}: ${error instanceof Error ? error.message : 'check failed'}`);
      else await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
