export default async function teardown() {
  await fetch('http://127.0.0.1:3100/__test_shutdown', {
    method: 'POST',
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
