import type { ProjectConfig } from '../prompts.js';

export function packageTemplate(config: ProjectConfig): string {
  const isExpress = config.framework === 'express';
  const persistenceDependency =
    config.template === 'ai-credits'
      ? config.database === 'postgres'
        ? `,\n    "@resvary/postgres": "^0.5.0-alpha.0"`
        : `,\n    "@resvary/sqlite": "^0.5.0-alpha.0"`
      : '';
  const minimumNode =
    config.template === 'ai-credits' && config.database === 'sqlite' ? '24' : '20';
  const migrationScript =
    config.template === 'ai-credits' && config.database === 'postgres'
      ? `,\n    "resvary:migrate": "resvary-postgres migrate"`
      : '';

  return `{
  "name": "${config.projectName}",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=${minimumNode}" },
  "scripts": {
    ${
      isExpress
        ? `"dev": "tsx watch src/index.ts",\n    "build": "tsc",\n    "start": "node dist/index.js"${migrationScript}`
        : `"dev": "next dev",\n    "build": "next build",\n    "start": "next start"${migrationScript}`
    }
  },
  "dependencies": {
    "@resvary/sdk": "^0.5.0-alpha.0"${persistenceDependency},
    ${
      isExpress
        ? `"express": "^4.18.2"`
        : `"next": "latest",\n    "react": "latest",\n    "react-dom": "latest"`
    }
  },
  "devDependencies": {
    "@types/node": "latest",
    "typescript": "latest"${
      isExpress
        ? `,\n    "@types/express": "latest",\n    "tsx": "latest"`
        : `,\n    "@types/react": "latest",\n    "@types/react-dom": "latest"`
    }
  }
}
`;
}
