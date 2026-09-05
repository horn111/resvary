import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import next from 'next';

export default async function globalSetup() {
  const root = process.cwd();
  const target = resolve(root, '../../.resvary/console-e2e.sqlite');
  await mkdir(dirname(target), { recursive: true });
  await Promise.all(
    [target, `${target}-wal`, `${target}-shm`].map((path) => rm(path, { force: true })),
  );
  await copyFile(resolve(root, 'fixtures/demo.sqlite'), target);

  process.env.RESVARY_PROJECT_ID = 'project_demo';
  process.env.RESVARY_CONSOLE_ADMIN_SECRET = 'e2e-admin-secret-with-at-least-32-characters';
  process.env.RESVARY_SQLITE_PATH = target;
  delete process.env.RESVARY_CONSOLE_DEMO_MODE;
  delete process.env.DATABASE_URL;

  const app = next({ dev: false, dir: root });
  const handle = app.getRequestHandler();
  await app.prepare();
  const server = createServer((request, response) => handle(request, response));
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(3010, resolveListen);
  });

  return async () => {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await app.close();
  };
}
