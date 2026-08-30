import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '../prompts.js';
import { envTemplate } from './env.js';
import { expressTemplate } from './express.js';
import { nextTemplate } from './next.js';
import { packageTemplate } from './package.js';
import { tsconfigTemplate } from './tsconfig.js';

describe('starter templates', () => {
  const base: ProjectConfig = {
    projectName: 'my-ai-app',
    framework: 'next',
    template: 'ai-credits',
    database: 'sqlite',
    pricing: 'request',
    payTo: '0x0000000000000000000000000000000000000000',
  };

  it('creates valid package manifests for both starter types', () => {
    const ai = JSON.parse(packageTemplate(base)) as {
      type: string;
      engines: { node: string };
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(ai.type).toBe('module');
    expect(ai.engines.node).toBe('>=24');
    expect(ai.dependencies['@resvary/sdk']).toBe('0.7.0');
    expect(ai.dependencies['@resvary/sqlite']).toBe('0.7.0');
    expect(ai.dependencies.next).toBe('16.3.3');
    expect(ai.devDependencies['@types/node']).toBe('^22.20.1');
    expect(ai.devDependencies['@types/react-dom']).toBe('^19.2.5');
    expect(ai.devDependencies.typescript).toBe('5.9.3');

    const legacy = JSON.parse(packageTemplate({ ...base, template: 'paid-api' })) as {
      engines: { node: string };
      dependencies: Record<string, string>;
    };
    expect(legacy.engines.node).toBe('>=20');
    expect(legacy.dependencies['@resvary/sqlite']).toBeUndefined();
    expect(ai.devDependencies.tsx).toBeUndefined();

    const express = JSON.parse(packageTemplate({ ...base, framework: 'express' })) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(express.scripts.start).toBe('node dist/index.js');
    expect(express.devDependencies.tsx).toBe('^4.20.6');
  });

  it('makes AI credits the functional embedded SDK starter', () => {
    const next = nextTemplate(base);
    const express = expressTemplate({ ...base, framework: 'express' });
    const env = envTemplate(base);
    expect(next).toContain('ledger.runMetered');
    expect(next).toContain('RESVARY_CUSTOMER_ID');
    expect(next).toContain('RESVARY_API_TOKEN');
    expect(env).toContain('RESVARY_API_TOKEN=\n');
    expect(env).not.toContain('RESVARY_API_TOKEN=replace-');
    const postgresEnv = envTemplate({ ...base, database: 'postgres' });
    expect(postgresEnv).toContain('RESVARY_WEBHOOK_SECRET=\n');
    expect(postgresEnv).not.toContain('RESVARY_WEBHOOK_SECRET=replace-');
    expect(next).not.toContain('ledger.grantCredits');
    expect(next).not.toContain('const { customerId');
    expect(express).toContain('createSqliteCreditStore');
    expect(express).toContain('RESVARY_API_TOKEN');
    expect(express).not.toContain('ledger.grantCredits');
    expect(express).not.toContain('const { customerId');
    const postgres = { ...base, database: 'postgres' as const };
    expect(nextTemplate(postgres)).toContain('createPostgresCreditStore');
    expect(JSON.parse(packageTemplate(postgres)).dependencies['@resvary/postgres']).toBe('0.7.0');
    expect(JSON.parse(packageTemplate(postgres)).dependencies['@resvary/worker']).toBe('0.7.0');
    expect(JSON.parse(packageTemplate(postgres)).scripts['resvary:migrate']).toBe(
      'resvary-postgres migrate',
    );
    expect(JSON.parse(packageTemplate(postgres)).scripts['resvary:worker']).toBe(
      'resvary-worker run',
    );
  });

  it('generates TypeScript configurations compatible with current toolchains', () => {
    const next = JSON.parse(tsconfigTemplate(base)) as {
      compilerOptions: Record<string, string>;
    };
    expect(next.compilerOptions.target).toBe('es2022');
    expect(next.compilerOptions.moduleResolution).toBe('bundler');

    const express = JSON.parse(tsconfigTemplate({ ...base, framework: 'express' })) as {
      compilerOptions: Record<string, string>;
    };
    expect(express.compilerOptions.rootDir).toBe('./src');
  });
});
