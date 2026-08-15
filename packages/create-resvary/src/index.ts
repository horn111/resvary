#!/usr/bin/env node

import pc from 'picocolors';
import { runPrompts } from './prompts.js';
import { generateProject } from './generator.js';

async function main() {
  console.log(pc.cyan('\n⚡ create-resvary\n'));

  const args = process.argv.slice(2);
  const initialProjectName = args[0];

  try {
    const config = await runPrompts(initialProjectName);

    console.log(pc.dim('\nScaffolding project...'));
    const files = await generateProject(config);

    console.log(pc.green(`\n✔ Created ${config.projectName}/`));
    for (const file of files) {
      console.log(pc.green(`  ✔ Generated ${file}`));
    }

    console.log(pc.cyan('\nNext steps:'));
    console.log(`  cd ${config.projectName}`);
    console.log('  npm install');
    console.log('  npm run dev');

    const readyMessage =
      config.template === 'ai-credits'
        ? 'Your AI app now has prepaid credits, metered usage, and durable balances.'
        : 'Your API is paywalled and ready to accept USDC.';
    console.log(pc.yellow(`\n${readyMessage}\n`));
  } catch (error) {
    if (error instanceof Error && error.message === 'Cancelled') {
      console.log(pc.yellow('\nScaffolding cancelled.\n'));
      process.exit(0);
    }
    console.error(pc.red('\nAn error occurred:'), error);
    process.exit(1);
  }
}

main().catch(console.error);
