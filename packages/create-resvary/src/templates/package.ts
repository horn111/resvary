import type { ProjectConfig } from '../prompts.js';

export function packageTemplate(config: ProjectConfig): string {
  const isExpress = config.framework === 'express';
  const sqliteDependency =
    config.template === 'ai-credits' ? `,\n    "@resvary/sqlite": "^0.4.0-alpha.0"` : '';
  const minimumNode = config.template === 'ai-credits' ? '24' : '20';

  return `{
  "name": "${config.projectName}",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=${minimumNode}" },
  "scripts": {
    ${
      isExpress
        ? `"dev": "tsx watch src/index.ts",\n    "build": "tsc",\n    "start": "node dist/index.js"`
        : `"dev": "next dev",\n    "build": "next build",\n    "start": "next start"`
    }
  },
  "dependencies": {
    "@resvary/sdk": "^0.4.0-alpha.0"${sqliteDependency},
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
