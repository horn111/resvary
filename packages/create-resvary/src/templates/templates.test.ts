import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '../prompts.js';
import { expressTemplate } from './express.js';
import { nextTemplate } from './next.js';
import { packageTemplate } from './package.js';

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
    expect(ai.dependencies['@resvary/sdk']).toBe('^0.5.0-alpha.1');
    expect(ai.dependencies['@resvary/sqlite']).toBe('^0.5.0-alpha.1');

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
    expect(express.devDependencies.tsx).toBe('latest');
  });

  it('makes AI credits the functional embedded SDK starter', () => {
    expect(nextTemplate(base)).toContain('ledger.runMetered');
    expect(nextTemplate(base)).toContain('starter-credit');
    expect(expressTemplate({ ...base, framework: 'express' })).toContain('createSqliteCreditStore');
    const postgres = { ...base, database: 'postgres' as const };
    expect(nextTemplate(postgres)).toContain('createPostgresCreditStore');
    expect(JSON.parse(packageTemplate(postgres)).dependencies['@resvary/postgres']).toBe(
      '^0.5.0-alpha.1',
    );
    expect(JSON.parse(packageTemplate(postgres)).scripts['resvary:migrate']).toBe(
      'resvary-postgres migrate',
    );
  });
});
