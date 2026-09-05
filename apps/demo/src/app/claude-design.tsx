import { ClaudeDesignController } from './claude-design-controller';
import { CLAUDE_DESIGN_HTML } from './claude-design.generated';
import styles from './claude-design.module.css';

const FOOTER_ISSUES_LINK =
  '<a href="https://github.com/horn111/resvary/issues" style="transition:color .2s">Issues</a>';
const FOOTER_X_LINK =
  '<a href="https://x.com/resvaryAI" rel="me" style="transition:color .2s">X / Twitter</a>';
const PRIMARY_USE_CASES_LINK = '<a href="#use-cases" style="transition:color .2s">Use cases</a>';
const PRIMARY_CONSOLE_LINK = '<a href="#operator-console" style="transition:color .2s">Console</a>';
const MOBILE_USE_CASES_LINK = '<a href="#use-cases">Use cases</a>';
const MOBILE_CONSOLE_LINK = '<a href="#operator-console">Console</a>';
const PRICING_SECTION_MARKER = '<section id="pricing"';
const OPERATOR_CONSOLE_SECTION = `<section id="operator-console" data-operator-console-section="true" data-reveal="1" style="border-top:1px solid var(--color-line);padding:100px 34px">
    <div style="max-width:1280px;margin:0 auto">
      <div style="display:grid;grid-template-columns:minmax(0,0.72fr) minmax(0,1.28fr);gap:min(8vw,110px);align-items:start">
        <div>
          <div style="font-family:var(--font-mono),'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:var(--color-ink-muted);margin-bottom:26px">Operator Console / 1.0</div>
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
const SITE_HTML = CLAUDE_DESIGN_HTML.replaceAll(
  'Hosted Postgres service',
  'Postgres deployment backend',
)
  .replaceAll('0.5 stable', '1.0 stable')
  .replace(PRIMARY_USE_CASES_LINK, `${PRIMARY_CONSOLE_LINK}\n      ${PRIMARY_USE_CASES_LINK}`)
  .replace(MOBILE_USE_CASES_LINK, `${MOBILE_CONSOLE_LINK}\n        ${MOBILE_USE_CASES_LINK}`)
  .replace(PRICING_SECTION_MARKER, `${OPERATOR_CONSOLE_SECTION}\n\n  ${PRICING_SECTION_MARKER}`)
  .replace(FOOTER_ISSUES_LINK, `${FOOTER_ISSUES_LINK}\n        ${FOOTER_X_LINK}`);

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
