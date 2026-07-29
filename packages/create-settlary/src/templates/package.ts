import type { ProjectConfig } from '../prompts.js';

export function packageTemplate(config: ProjectConfig): string {
  const isExpress = config.framework === 'express';

  return `{
  "name": "${config.projectName}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    ${isExpress 
      ? `"dev": "ts-node-dev src/index.ts",\n    "build": "tsc"` 
      : `"dev": "next dev",\n    "build": "next build",\n    "start": "next start"`}
  },
  "dependencies": {
    "@settlary/sdk": "latest",
    ${isExpress 
      ? `"express": "^4.18.2"` 
      : `"next": "latest",\n    "react": "latest",\n    "react-dom": "latest"`}
  },
  "devDependencies": {
    "@types/node": "latest",
    "typescript": "latest"${isExpress 
      ? `,\n    "@types/express": "latest",\n    "ts-node-dev": "latest"`
      : `,\n    "@types/react": "latest",\n    "@types/react-dom": "latest"`}
  }
}
`;
}
