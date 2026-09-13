import { ClaudeDesignController } from './claude-design-controller';
import { CLAUDE_DESIGN_HTML } from './claude-design.generated';
import styles from './claude-design.module.css';

const FOOTER_ISSUES_LINK =
  '<a href="https://github.com/horn111/resvary/issues" style="transition:color .2s">Issues</a>';
const FOOTER_X_LINK =
  '<a href="https://x.com/resvaryAI" rel="me" style="transition:color .2s">X / Twitter</a>';
const FOOTER_PRICING_LINK = '<a href="/pricing.md" style="transition:color .2s">Pricing data</a>';
const PRIMARY_USE_CASES_LINK = '<a href="#use-cases" style="transition:color .2s">Use cases</a>';
const PRIMARY_CONSOLE_LINK = '<a href="#operator-console" style="transition:color .2s">Console</a>';
const MOBILE_USE_CASES_LINK = '<a href="#use-cases">Use cases</a>';
const MOBILE_CONSOLE_LINK = '<a href="#operator-console">Console</a>';
const MOBILE_MENU_SUMMARY = `<summary>
        <span data-mobile-nav-label="true">Menu</span>
        <span data-mobile-nav-icon="true" aria-hidden="true"><span></span><span></span></span>
      </summary>`;
const PRICING_SECTION_MARKER = '<section id="pricing"';
const OPERATOR_CONSOLE_SECTION = `<section id="operator-console" data-operator-console-section="true" data-reveal="1" style="border-top:1px solid var(--color-line);padding:100px 34px">
    <div style="max-width:1280px;margin:0 auto">
      <div style="display:grid;grid-template-columns:minmax(0,0.72fr) minmax(0,1.28fr);gap:min(8vw,110px);align-items:start">
        <div>
          <div style="font-family:var(--font-mono),'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:var(--color-ink-muted);margin-bottom:26px">10 / Operator Console</div>
          <h2 style="margin:0;font-size:clamp(30px,3.6vw,54px);line-height:1.02;letter-spacing:-0.032em;font-weight:500;max-width:17ch;text-wrap:balance">Explain every balance. Recover every incident safely.</h2>
          <p style="margin:26px 0 0;max-width:48ch;font-size:16.5px;line-height:1.6;color:var(--color-ink-body)">A self-hosted command ledger for one Resvary project. Search customers, trace a charge through its receipt and price version, and run only the recovery actions the ledger can prove are safe.</p>
          <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:30px">
            <a href="https://github.com/horn111/resvary/blob/main/docs/operator-console.md" style="display:inline-flex;align-items:center;padding:14px 22px;background:var(--color-ink);color:var(--color-canvas);font-family:var(--font-mono),'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase">Open setup guide</a>
            <a href="https://github.com/horn111/resvary/blob/main/docs/migration-1.0.md" style="display:inline-flex;align-items:center;padding:14px 22px;border:1px solid var(--color-line-strong);font-family:var(--font-mono),'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-ink-strong)">Migration guide</a>
          </div>
        </div>
        <div style="border:1px solid var(--color-line-strong);font-family:var(--font-mono),'JetBrains Mono',monospace">
          <div data-operator-console-metrics="true" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-bottom:1px solid var(--color-line-strong)">
            <div style="padding:18px;border-right:1px solid var(--color-line)"><span style="display:block;font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-ink-muted)">Available</span><strong style="display:block;margin-top:9px;font-size:24px;font-weight:400">$12,375.60</strong></div>
            <div style="padding:18px;border-right:1px solid var(--color-line)"><span style="display:block;font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-ink-muted)">Overdue</span><strong style="display:block;margin-top:9px;font-size:24px;font-weight:400">1</strong></div>
            <div style="padding:18px"><span style="display:block;font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-ink-muted)">Dead letter</span><strong style="display:block;margin-top:9px;font-size:24px;font-weight:400">1</strong></div>
          </div>
          <div data-operator-console-capabilities="true" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--color-line)">
            <div style="min-height:138px;padding:20px;background:var(--color-canvas)"><span style="font-size:10.5px;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-ink-muted)">Overview + Customers</span><p style="margin:16px 0 0;font-size:13.5px;line-height:1.6;color:var(--color-ink-body)">Balances, lots, grants, reservations, funding, receipts, and one chronological customer record.</p></div>
            <div style="min-height:138px;padding:20px;background:var(--color-canvas)"><span style="font-size:10.5px;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-ink-muted)">Audit Explorer</span><p style="margin:16px 0 0;font-size:13.5px;line-height:1.6;color:var(--color-ink-body)">Charge → receipt → reservation → price → ledger entries, with the original JSON intact.</p></div>
            <div style="min-height:138px;padding:20px;background:var(--color-canvas)"><span style="font-size:10.5px;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-ink-muted)">Guarded operations</span><p style="margin:16px 0 0;font-size:13.5px;line-height:1.6;color:var(--color-ink-body)">Positive grants, reasoned adjustments, overdue expiry sweeps, and dead-letter requeue only.</p></div>
            <div style="min-height:138px;padding:20px;background:var(--color-canvas)"><span style="font-size:10.5px;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-ink-muted)">Self-hosted boundary</span><p style="margin:16px 0 0;font-size:13.5px;line-height:1.6;color:var(--color-ink-body)">Postgres in production, SQLite for local and single-node use. No outbound telemetry.</p></div>
          </div>
          <div style="display:flex;justify-content:space-between;gap:20px;padding:14px 18px;color:var(--color-ink-muted);font-size:10.5px;letter-spacing:0.08em;text-transform:uppercase"><span>One instance / one project</span><span>Read-only synthetic preview mode</span></div>
        </div>
      </div>
    </div>
  </section>`;
const ACCESS_SECTION = `<section id="pricing" data-reveal="1" style="border-top:1px solid var(--color-line);padding:100px 34px">
    <div style="max-width:1280px;margin:0 auto;display:grid;grid-template-columns:minmax(0,0.72fr) minmax(0,1.28fr);gap:min(8vw,110px);align-items:start">
      <div>
        <div style="font-family:var(--font-mono),'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:var(--color-ink-muted);margin-bottom:26px">11 / Access</div>
        <h2 style="margin:0;font-size:clamp(30px,3.6vw,54px);line-height:1.02;letter-spacing:-0.032em;font-weight:500;max-width:17ch;text-wrap:balance">Install version 1.0. Run it in your stack.</h2>
      </div>
      <div style="display:flex;flex-direction:column;gap:28px">
        <p style="margin:0;max-width:65ch;font-size:17px;line-height:1.6;color:var(--color-ink-body);text-wrap:pretty">The Apache-2.0 packages are published on npm. Use SQLite locally or on one node; use Postgres and the worker for multi-process deployments. The Operator Console, signed webhooks, and Testnet funding adapters ship with the self-hosted release.</p>
        <div style="display:grid;grid-template-columns:minmax(0,0.35fr) minmax(0,0.65fr);border-top:1px solid var(--color-line);font-size:15px;line-height:1.55">
          <span style="padding:18px 18px 18px 0;font-family:var(--font-mono),'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-ink-muted)">Not included</span>
          <span style="padding:18px 0;color:var(--color-ink-body)">Hosted cloud, enterprise SLA, Mainnet settlement, tax invoices, and transferable or redeemable balances.</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:12px">
          <a href="https://github.com/horn111/resvary" style="display:inline-flex;align-items:center;padding:14px 22px;background:var(--color-ink);color:var(--color-canvas);font-family:var(--font-mono),'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase">Open the repository</a>
          <a href="https://github.com/horn111/resvary/blob/main/docs/getting-started.md" style="display:inline-flex;align-items:center;padding:14px 22px;border:1px solid var(--color-line-strong);font-family:var(--font-mono),'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-ink-strong)">Getting started</a>
        </div>
      </div>
    </div>
  </section>`;

function replaceSectionByLabel(html: string, label: string, replacement = '') {
  const markerIndex = html.indexOf(`>${label}</div>`);
  const sectionStart = html.lastIndexOf('<section', markerIndex);
  const sectionEnd = html.indexOf('</section>', markerIndex);
  if (markerIndex < 0 || sectionStart < 0 || sectionEnd < 0) {
    throw new Error(`Unable to find generated section: ${label}`);
  }
  return `${html.slice(0, sectionStart)}${replacement}${html.slice(sectionEnd + 10)}`;
}

let SITE_HTML = CLAUDE_DESIGN_HTML.replaceAll(
  'Hosted Postgres service',
  'Postgres deployment backend',
)
  .replaceAll('0.5 stable', '1.0 stable')
  .replace('<summary>Menu</summary>', MOBILE_MENU_SUMMARY)
  .replace(
    'Version 0.5 supports linear multi-dimensional rates. Tiering, packages, subscriptions, monthly minimums, and allowances are outside the current scope.',
    'Version 1.0 supports linear, graduated, and package price components with integer-only rating. Package pricing charges each started block and does not create reusable entitlements.',
  )
  .replace(
    'The packages currently live in the Resvary monorepo. Use the <a href="https://github.com/horn111/resvary/blob/main/docs/getting-started.md" style="color:var(--color-ink);border-bottom:1px solid rgba(242,242,240,0.35)">setup guide</a> until public package releases are available.',
    'Install the published 1.0 packages from npm. Use @resvary/sdk with @resvary/sqlite locally; add @resvary/postgres and @resvary/worker for multi-process deployments.',
  )
  .replace(
    'The deterministic demo needs no AI key. Grant credits, run a request, replay it without a second charge, or trigger a provider failure and inspect the stored result.',
    'The deterministic ledger demo needs no AI key. The buyer-agent prototype shows the full Testnet path with OpenAI Agents SDK, Circle Agent Wallet, Gateway, and Arc.',
  )
  .replace(
    'Run the interactive demo <span style="opacity:0.5">→</span></a>',
    'Run the ledger demo <span style="opacity:0.5">→</span></a>\n        <a href="https://agent.resvary.xyz" style="align-self:flex-start;display:inline-flex;align-items:center;gap:10px;padding:14px 22px;border:1px solid var(--color-line-strong);font-family:var(--font-mono),\'JetBrains Mono\',monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-ink-strong)">Open the agent demo <span style="opacity:0.5">→</span></a>',
  )
  .replace(PRIMARY_USE_CASES_LINK, `${PRIMARY_CONSOLE_LINK}\n      ${PRIMARY_USE_CASES_LINK}`)
  .replace(MOBILE_USE_CASES_LINK, `${MOBILE_CONSOLE_LINK}\n        ${MOBILE_USE_CASES_LINK}`)
  .replace(
    FOOTER_ISSUES_LINK,
    `${FOOTER_ISSUES_LINK}\n        ${FOOTER_X_LINK}\n        ${FOOTER_PRICING_LINK}`,
  );

SITE_HTML = replaceSectionByLabel(SITE_HTML, '04 / Included in 0.5');
SITE_HTML = replaceSectionByLabel(SITE_HTML, '11 / Self-hosted boundary');
SITE_HTML = replaceSectionByLabel(SITE_HTML, '12 / Open source');
SITE_HTML = replaceSectionByLabel(SITE_HTML, '13 / Access', ACCESS_SECTION)
  .replaceAll('05 / Usage pricing', '04 / Usage pricing')
  .replaceAll('06 / TypeScript SDK', '05 / TypeScript SDK')
  .replaceAll('07 / Demo', '06 / Demo')
  .replaceAll('08 / Use cases', '07 / Use cases')
  .replaceAll('09 / Transactions', '08 / Transactions')
  .replaceAll('10 / Credit model', '09 / Credit model')
  .replaceAll('14 / FAQ', '12 / FAQ')
  .replace(PRICING_SECTION_MARKER, `${OPERATOR_CONSOLE_SECTION}\n\n  ${PRICING_SECTION_MARKER}`);

export function ClaudeDesignPage() {
  return (
    <>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <div
        className={styles.claudeDesign}
        data-resvary-page="true"
        dangerouslySetInnerHTML={{ __html: SITE_HTML }}
      />
      <ClaudeDesignController />
    </>
  );
}
