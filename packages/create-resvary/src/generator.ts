import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectConfig } from './prompts.js';
import { expressTemplate } from './templates/express.js';
import { nextTemplate } from './templates/next.js';
import { packageTemplate } from './templates/package.js';
import { tsconfigTemplate } from './templates/tsconfig.js';
import { envTemplate } from './templates/env.js';

export async function generateProject(config: ProjectConfig): Promise<string[]> {
  const targetDir = path.resolve(process.cwd(), config.projectName);
  const filesCreated: string[] = [];

  // Create directory
  await fs.mkdir(targetDir, { recursive: true });

  // Generate common files
  await write(targetDir, 'package.json', packageTemplate(config), filesCreated);
  await write(targetDir, 'tsconfig.json', tsconfigTemplate(config), filesCreated);
  await write(targetDir, '.env', envTemplate(config), filesCreated);
  await write(targetDir, '.gitignore', 'node_modules\n.env\ndist\n.next\n.resvary\n', filesCreated);

  // Generate framework specific files
  if (config.framework === 'express') {
    await fs.mkdir(path.join(targetDir, 'src'), { recursive: true });
    await write(targetDir, 'src/index.ts', expressTemplate(config), filesCreated);
  } else if (config.framework === 'next') {
    const route = config.template === 'ai-credits' ? 'generate' : 'data';
    await fs.mkdir(path.join(targetDir, `app/api/${route}`), { recursive: true });
    await write(targetDir, `app/api/${route}/route.ts`, nextTemplate(config), filesCreated);
    await write(
      targetDir,
      'app/layout.tsx',
      'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n',
      filesCreated,
    );
    await write(
      targetDir,
      'app/page.tsx',
      config.template === 'ai-credits'
        ? 'export default function Page() { return <main><h1>AI prepaid credits</h1><p>POST customerId, prompt, and idempotencyKey to /api/generate.</p></main>; }\n'
        : 'export default function Page() { return <main><h1>Paid API</h1><p>Request /api/data to try the x402 paywall.</p></main>; }\n',
      filesCreated,
    );
    if (config.template === 'ai-credits') {
      await write(
        targetDir,
        'next.config.mjs',
        `export default { serverExternalPackages: ['@resvary/${config.database}'] };\n`,
        filesCreated,
      );
    }
  }

  return filesCreated;
}

async function write(dir: string, file: string, content: string, tracking: string[]) {
  const filePath = path.join(dir, file);
  await fs.writeFile(filePath, content, 'utf-8');
  tracking.push(file);
}
