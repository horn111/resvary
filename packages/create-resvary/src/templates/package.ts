import type { ProjectConfig } from '../prompts.js';

export function packageTemplate(config: ProjectConfig): string {
  const isExpress = config.framework === 'express';
  const persistenceDependency =
    config.template === 'ai-credits'
      ? config.database === 'postgres'
        ? `,\n    "@resvary/postgres": "0.7.0",\n    "@resvary/worker": "0.7.0"`
        : `,\n    "@resvary/sqlite": "0.7.0"`
      : '';
  const minimumNode =
    config.template === 'ai-credits' && config.database === 'sqlite' ? '24' : '20';
  const migrationScript =
    config.template === 'ai-credits' && config.database === 'postgres'
      ? `,\n    "resvary:migrate": "resvary-postgres migrate"`
      : '';
  const workerScript =
    config.template === 'ai-credits' && config.database === 'postgres'
      ? `,\n    "resvary:worker": "resvary-worker run"`
      : '';

  return `{
  "name": ${JSON.stringify(config.projectName)},
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=${minimumNode}" },
  "scripts": {
    ${
      isExpress
        ? `"dev": "tsx watch src/index.ts",\n    "build": "tsc",\n    "start": "node dist/index.js"${migrationScript}${workerScript}`
        : `"dev": "next dev",\n    "build": "next build",\n    "start": "next start"${migrationScript}${workerScript}`
    }
  },
  "dependencies": {
    "@resvary/sdk": "0.7.0"${persistenceDependency},
    ${
      isExpress
        ? `"express": "^4.21.2"`
        : `"next": "16.3.3",\n    "react": "19.2.8",\n    "react-dom": "19.2.8"`
    }
  },
  "devDependencies": {
    "@types/node": "^22.20.1",
    "typescript": "5.9.3"${
      isExpress
        ? `,\n    "@types/express": "^5.0.6",\n    "tsx": "^4.20.6"`
        : `,\n    "@types/react": "^19.2.18",\n    "@types/react-dom": "^19.2.5"`
    }
  }
}
`;
}
