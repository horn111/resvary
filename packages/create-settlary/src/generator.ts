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
  await write(targetDir, '.gitignore', 'node_modules\n.env\ndist\n.next', filesCreated);

  // Generate framework specific files
  if (config.framework === 'express') {
    await fs.mkdir(path.join(targetDir, 'src'), { recursive: true });
    await write(targetDir, 'src/index.ts', expressTemplate(config), filesCreated);
  } else if (config.framework === 'next') {
    await fs.mkdir(path.join(targetDir, 'app/api/data'), { recursive: true });
    await write(targetDir, 'app/api/data/route.ts', nextTemplate(config), filesCreated);
    await write(targetDir, 'app/layout.tsx', 'export default function RootLayout({ children }: { children: React.ReactNode }) { return (<html><body>{children}</body></html>); }', filesCreated);
    await write(targetDir, 'app/page.tsx', 'export default function Page() { return <h1>My Paid API</h1>; }', filesCreated);
  }

  return filesCreated;
}

async function write(dir: string, file: string, content: string, tracking: string[]) {
  const filePath = path.join(dir, file);
  await fs.writeFile(filePath, content, 'utf-8');
  tracking.push(file);
}
