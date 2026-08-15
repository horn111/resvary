import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const generatedPath = resolve(
  import.meta.dirname,
  '../apps/demo/src/app/claude-design.generated.ts',
);
const generated = readFileSync(generatedPath, 'utf8');
const match = generated.match(/export const CLAUDE_DESIGN_HTML = ("[\s\S]*");\s*$/);

if (!match) throw new Error('Generated Claude Design HTML constant was not found');

const html = JSON.parse(match[1]);
const assertions = [
  ['one main landmark', (html.match(/<main\b/g) ?? []).length === 1],
  ['interactive demo mount', html.includes('data-claude-demo-root="true"')],
  ['receipt action hook', html.includes('data-claude-print="true"')],
  ['primary navigation label', html.includes('aria-label="Primary"')],
  ['mobile navigation label', html.includes('aria-label="Mobile"')],
  ['footer navigation label', html.includes('aria-label="Footer"')],
  ['semantic color tokens', html.includes('var(--color-ink-body)')],
  ['semantic font tokens', html.includes('var(--font-mono)')],
  ['semantic credit model table', html.includes('data-credit-model-table="true"')],
  ['no exported raw table tags', !html.includes('sc-raw-')],
  ['balanced benefit grid', html.includes('data-benefit-grid="true"')],
  ['no self-reloading demo links', !html.includes('href="https://resvary.vercel.app"')],
  // impeccable-disable-next-line layout-transition -- negative assertion, not executable CSS
  ['no layout-property hover transition', !html.includes('transition:padding-left')],
];

const failures = assertions.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  throw new Error(`Claude Design integrity check failed: ${failures.join(', ')}`);
}

console.log(`Claude Design integrity check passed (${assertions.length} assertions).`);
