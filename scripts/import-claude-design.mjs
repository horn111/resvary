import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [inputArg, outputArg] = process.argv.slice(2);

if (!inputArg || !outputArg) {
  throw new Error('Usage: node scripts/import-claude-design.mjs <export.html> <output.ts>');
}

const source = readFileSync(resolve(inputArg), 'utf8');
const match = source.match(/<script type="__bundler\/template">\s*(.*?)\s*<\/script>/s);

if (!match) throw new Error('Claude Design template payload was not found');

const template = JSON.parse(match[1]);
let designStyle = [...template.matchAll(/<style>(.*?)<\/style>/gs)]
  .map((styleMatch) => styleMatch[1])
  .find((css) => css.includes('@keyframes feedPaper'));

if (!designStyle) throw new Error('Claude Design interaction styles were not found');

const helmetEnd = template.indexOf('</helmet>');
const logicStart = template.lastIndexOf('<script type="text/x-dc"');

if (helmetEnd < 0 || logicStart < 0) {
  throw new Error('Claude Design document boundaries were not found');
}

let markup = template.slice(helmetEnd + '</helmet>'.length, logicStart);

markup = markup
  .replace(/ref="\{\{\s*([A-Za-z0-9_]+)\s*\}\}"/g, 'data-claude-ref="$1"')
  .replace(/\ssc-camel-on-click="\{\{\s*printReceipt\s*\}\}"/g, ' data-claude-print="true"')
  .replace(/\sstyle-hover="([^"]*)"/g, ' data-hover-style="$1"')
  .replace(/<\/?x-dc>/g, '')
  .trim();

const semanticTableTags = [
  ['sc-raw-table', 'table'],
  ['sc-raw-thead', 'thead'],
  ['sc-raw-tbody', 'tbody'],
  ['sc-raw-tr', 'tr'],
  ['sc-raw-th', 'th'],
  ['sc-raw-td', 'td'],
];

for (const [exportedTag, semanticTag] of semanticTableTags) {
  markup = markup
    .replaceAll(`<${exportedTag}`, `<${semanticTag}`)
    .replaceAll(`</${exportedTag}>`, `</${semanticTag}>`);
}

markup = markup
  .replace(
    '<table style="width:100%;border-collapse:collapse;text-align:left">',
    '<table data-credit-model-table="true" style="width:100%;border-collapse:collapse;text-align:left">',
  )
  .replaceAll('<th style=', '<th scope="col" style=')
  .replace(
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:44px 60px">',
    '<div data-benefit-grid="true" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:44px 60px">',
  );

const copyReplacements = [
  ['>Pricing</a>', '>Access</a>'],
  ['Explore the live demo', 'Run the live demo'],
  ['View the source on GitHub', 'View source on GitHub'],
  ['01 — The problem', '01 / Problem'],
  ['02 — Core flow', '02 / Credit lifecycle'],
  ['03 — Benefits', '03 / Why Resvary'],
  ['04 — Capabilities', '04 / Included in alpha'],
  ['05 — Metering', '05 / Usage pricing'],
  ['06 — SDK', '06 / TypeScript SDK'],
  ['07 — Live demo', '07 / Demo'],
  ['08 — Use cases', '08 / Use cases'],
  ['09 — Persistence', '09 / Transactions'],
  ['10 — Comparison', '10 / Credit model'],
  ['11 — Boundaries', '11 / Alpha boundary'],
  ['12 — Open source', '12 / Open source'],
  ['13 — Pricing', '13 / Access'],
  ['14 — FAQ', '14 / FAQ'],
  [
    'Your product must decide whether a customer can start an AI request before the final cost exists. Tokens, seconds, images, and tool calls arrive after the provider finishes. A balance column cannot protect concurrent requests, recover from retries, release failed work, or explain a disputed charge.',
    'You must decide whether a customer can start an AI request before the final cost exists. Tokens, seconds, images, and tool calls arrive after the provider finishes.',
  ],
  [
    'Resvary puts a transaction boundary around that moment. Your application authorizes a maximum amount first, then records the real charge after execution.',
    'Resvary checks available credits and creates a reservation before provider work begins. It commits the final charge after execution and releases the unused amount.',
  ],
  ['The billing boundary around every AI call', 'The credit boundary around each AI call'],
  ['Every commit prints its own explanation', 'Each commit records its own explanation'],
  [
    'A commit closes the reservation, charges the metered amount, releases the remainder, and stores a receipt bound to the price version that rated it. Nothing about the charge is inferred later.',
    'The usage receipt records the price version, line items, final charge, released credits, and resulting balance. Your team can trace each balance change without reconstructing it from logs.',
  ],
  ['Print the receipt', 'Print sample receipt'],
  ['Included in the 0.3 alpha', 'Credit primitives that survive retries'],
  ['Meter the units your product already receives', 'Price the usage your provider returns'],
  [
    'Wrap the provider call with a metered credit lifecycle',
    'Wrap each provider call in a metered lifecycle',
  ],
  [
    'reserves estimated usage, runs your provider callback, commits the actual usage, and returns the released amount and receipt.',
    'reserves estimated usage, runs your provider callback, commits the final charge, and returns the released amount with a receipt.',
  ],
  ['Copy snippet', 'Copy code'],
  ['repository setup instructions', 'setup guide'],
  ['Inspect the full lifecycle in the demo', 'Run the credit lifecycle in one demo'],
  [
    'The deterministic demo works without an AI API key. Grant credits, run a simulated AI request, replay its idempotency key, trigger a provider failure, and inspect every stored result.',
    'The deterministic demo needs no AI key. Grant credits, run a request, replay it without a second charge, or trigger a provider failure and inspect the stored result.',
  ],
  ['Open the interactive demo', 'Run the interactive demo'],
  ['Built for variable-cost AI workloads', 'Add prepaid credits to variable-cost AI workloads'],
  [
    'A balance column records a number. Resvary records the lifecycle.',
    'A credit balance needs a transaction lifecycle',
  ],
  [
    'Resvary 0.3 validates the embedded credit domain, SQLite persistence, starter integration, and Arc Testnet funding path. It does not claim to provide a hosted billing service or a complete financial stack.',
    'Resvary 0.4 includes the embedded credit domain, SQLite persistence, direct Arc Testnet funding, and Gateway Nanopayment funding. Hosted billing, Postgres, mainnet settlement, and multi-node deployment remain planned work.',
  ],
  [
    'Resvary ships as an Apache-2.0 TypeScript monorepo. You can inspect the balance rules, run the test suite, use the embedded store interface, and extend funding without sending usage data to a hosted billing vendor.',
    'Run the Apache-2.0 TypeScript code inside your application. Inspect the balance rules, run the tests, use the store interface, and keep product usage in your infrastructure.',
  ],
  ['Explore the repository', 'View the repository'],
  [
    'Self-host it today. Hand it over later.',
    'Run the open-source alpha or request an integration review',
  ],
  [
    'Resvary is free software under Apache-2.0, and self-hosting is the only way to run it right now. A managed service is on the roadmap for teams that would rather not operate the ledger themselves — nothing is billable yet.',
    'Run Resvary in your application today. Design-partner reviews are available for a small number of AI teams. A managed service remains a roadmap item with no launch date or price.',
  ],
  ['Unchanged  Resvary never holds customer funds', 'Resvary never holds customer funds'],
  ['>Self-hosted</span>', '>Open-source alpha</span>'],
  ['>$0</span>', '>Apache-2.0</span>'],
  ['>Apache-2.0, available now</span>', '>Source available now</span>'],
  ['>Free</span>', '>Alpha review</span>'],
  ['>Managed cloud</span>', '>Managed service</span>'],
  ['>Not priced</span>', '>Planned</span>'],
  ['Clone the repository', 'Open the repository'],
  ['Start a conversation', 'Request an alpha review'],
  ['What self-hosting actually requires', 'What you operate in the current alpha'],
  ['Managed, when it exists', 'Managed service, when available'],
  [
    'What happens when billing fails after the provider succeeds?',
    'What happens if commit fails after the AI request succeeds?',
  ],
  [
    'The reservation remains open. Your application can retry the commit with the same idempotency key instead of losing the completed usage or charging twice.',
    'The reservation stays open. Retry the commit with the same idempotency key to record the completed usage without charging twice.',
  ],
  ['How can I try it?', 'How do I try the alpha?'],
  [
    'Open the deterministic live demo or clone the repository and follow the getting-started guide. The demo does not require an AI API key.',
    'Run the deterministic demo without an AI key, or open the repository and follow the getting-started guide.',
  ],
  [
    'Put a retry-safe credit ledger around your next AI request',
    'Add a retry-safe credit ledger to your next AI request',
  ],
  [
    'Inspect the lifecycle in the live demo, then use the open-source repository to evaluate the SDK in your application.',
    'Run the lifecycle in the demo, then evaluate the open-source SDK inside your application.',
  ],
  ['View Resvary on GitHub', 'View the repository'],
];

for (const [currentCopy, improvedCopy] of copyReplacements) {
  if (!markup.includes(currentCopy)) {
    throw new Error(`Claude Design copy was not found: ${currentCopy}`);
  }
  markup = markup.replaceAll(currentCopy, improvedCopy);
}

markup = markup.replaceAll('0.3 alpha', '0.4 alpha');

markup = markup
  .replaceAll('href="https://resvary.vercel.app"', 'href="#interactive-demo"')
  .replace(
    'data-claude-ref="setPrintLine"',
    'data-claude-ref="setPrintLine" role="status" aria-live="polite"',
  )
  .replace('data-claude-ref="setCopyBtn"', 'data-claude-ref="setCopyBtn" aria-live="polite"')
  .replaceAll('class="faq-plus"', 'class="faq-plus" aria-hidden="true"')
  // impeccable-disable-next-line layout-transition -- source literal is converted to transform CSS
  .replaceAll('transition:padding-left .3s', 'transition:transform .3s')
  .replaceAll('padding-left:12px', 'transform:translateX(12px)');

let navigationIndex = 0;
markup = markup.replaceAll('<nav style=', () => {
  navigationIndex += 1;
  return `<nav aria-label="${navigationIndex === 1 ? 'Primary' : 'Footer'}" style=`;
});

const mobileNavigation = `
    <details data-mobile-nav="true">
      <summary>Menu</summary>
      <nav aria-label="Mobile">
        <a href="#product">Product</a>
        <a href="#how">How it works</a>
        <a href="#demo">Demo</a>
        <a href="#use-cases">Use cases</a>
        <a href="#pricing">Access</a>
        <a href="https://github.com/horn111/resvary#readme">Docs</a>
        <a href="https://github.com/horn111/resvary">GitHub</a>
      </nav>
    </details>`;

markup = markup.replace('</nav>', `</nav>${mobileNavigation}`);

markup = markup.replace('</header>', '</header><main id="main-content" tabindex="-1">');
markup = markup.replace('<footer ', '</main><footer ');

const demoSection = /(<section id="demo"[\s\S]*?)(\n\s*<\/section>)/;
if (!demoSection.test(markup)) throw new Error('Claude Design demo section was not found');
markup = markup.replace(
  demoSection,
  `$1\n      <div id="interactive-demo" data-claude-demo-root="true"></div>$2`,
);

const designTokenReplacements = [
  [
    "'Helvetica Neue',Helvetica,Arial,sans-serif",
    "var(--font-sans),'Helvetica Neue',Helvetica,Arial,sans-serif",
  ],
  ["'JetBrains Mono',monospace", "var(--font-mono),'JetBrains Mono',monospace"],
  ['#0a0a0a', 'var(--color-canvas)'],
  ['#0c0c0c', 'var(--color-code-surface)'],
  ['#0e0e0e', 'var(--color-surface-raised)'],
  ['#f2f2f0', 'var(--color-ink)'],
  ['#ffffff', 'var(--color-white)'],
  ['#fff', 'var(--color-white)'],
  ['rgba(10,10,10,0.78)', 'var(--color-header)'],
  ['rgba(242,242,240,0.92)', 'var(--color-ink-strong)'],
  ['rgba(242,242,240,0.9)', 'var(--color-ink-strong)'],
  ['rgba(242,242,240,0.85)', 'var(--color-ink-strong)'],
  ['rgba(242,242,240,0.72)', 'var(--color-ink-body)'],
  ['rgba(242,242,240,0.66)', 'var(--color-ink-body)'],
  ['rgba(242,242,240,0.62)', 'var(--color-ink-body)'],
  ['rgba(242,242,240,0.6)', 'var(--color-ink-body)'],
  ['rgba(242,242,240,0.58)', 'var(--color-ink-muted)'],
  ['rgba(242,242,240,0.56)', 'var(--color-ink-muted)'],
  ['rgba(242,242,240,0.55)', 'var(--color-ink-muted)'],
  ['rgba(242,242,240,0.5)', 'var(--color-ink-subtle)'],
  ['rgba(242,242,240,0.45)', 'var(--color-ink-subtle)'],
  ['rgba(242,242,240,0.44)', 'var(--color-ink-subtle)'],
  ['rgba(242,242,240,0.22)', 'var(--color-line-strong)'],
  ['rgba(242,242,240,0.2)', 'var(--color-line-strong)'],
  ['rgba(242,242,240,0.16)', 'var(--color-line)'],
  ['rgba(242,242,240,0.14)', 'var(--color-line)'],
  ['rgba(242,242,240,0.12)', 'var(--color-line)'],
  ['rgba(242,242,240,0.1)', 'var(--color-line)'],
  ['rgba(242,242,240,0.09)', 'var(--color-line-soft)'],
  ['rgba(242,242,240,0.08)', 'var(--color-line-soft)'],
  ['rgba(242,242,240,0)', 'transparent'],
];

for (const [literal, token] of designTokenReplacements) {
  markup = markup.replaceAll(literal, token);
  designStyle = designStyle.replaceAll(literal, token);
}

const html = `<style>${designStyle}</style>${markup}`;
const output = `// Generated from the reviewed Claude Design export.\n// Re-run scripts/import-claude-design.mjs when the source design changes.\n// impeccable-disable layout-transition -- escaped HTML produces regex false positives; parsed CSS is checked separately\nexport const CLAUDE_DESIGN_HTML = ${JSON.stringify(html)};\n`;

writeFileSync(resolve(outputArg), output, 'utf8');
