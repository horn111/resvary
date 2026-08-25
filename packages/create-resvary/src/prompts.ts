import prompts from 'prompts';

export interface ProjectConfig {
  projectName: string;
  framework: 'express' | 'next';
  template: 'ai-credits' | 'paid-api';
  database: 'sqlite' | 'postgres';
  pricing: 'request' | 'second' | 'job';
  payTo: string;
}

export async function runPrompts(initialProjectName?: string): Promise<ProjectConfig> {
  const onCancel = () => {
    throw new Error('Cancelled');
  };

  const response = await prompts(
    [
      {
        type: initialProjectName ? null : 'text',
        name: 'projectName',
        message: 'Project name:',
        initial: 'my-ai-credits-app',
      },
      {
        type: 'select',
        name: 'template',
        message: 'Starter:',
        choices: [
          { title: 'AI prepaid credits', value: 'ai-credits' },
          { title: 'Legacy x402 paid API', value: 'paid-api' },
        ],
      },
      {
        type: 'select',
        name: 'framework',
        message: 'Framework:',
        choices: [
          { title: 'Express', value: 'express' },
          { title: 'Next.js (App Router)', value: 'next' },
        ],
      },
      {
        type: (_previous, values) => (values.template === 'ai-credits' ? 'select' : null),
        name: 'database',
        message: 'Persistence:',
        choices: [
          { title: 'SQLite — local', value: 'sqlite' },
          { title: 'Postgres — deployment', value: 'postgres' },
        ],
        initial: 0,
      },
      {
        type: (_previous, values) => (values.template === 'paid-api' ? 'select' : null),
        name: 'pricing',
        message: 'Pricing model:',
        choices: [
          { title: 'Per-request ($0.001/call)', value: 'request' },
          { title: 'Per-second ($0.01/s)', value: 'second' },
          { title: 'Per-job ($0.50 base)', value: 'job' },
        ],
      },
      {
        type: (_previous, values) => (values.template === 'paid-api' ? 'text' : null),
        name: 'payTo',
        message: 'Your wallet address to receive USDC (payTo):',
        initial: '0x0000000000000000000000000000000000000000',
      },
    ],
    { onCancel },
  );

  return {
    projectName: initialProjectName || response.projectName,
    framework: response.framework,
    template: response.template,
    database: response.database ?? 'sqlite',
    pricing: response.pricing ?? 'request',
    payTo: response.payTo ?? '0x0000000000000000000000000000000000000000',
  };
}
