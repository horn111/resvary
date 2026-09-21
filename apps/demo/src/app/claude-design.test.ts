import { describe, expect, it } from 'vitest';
import { SITE_HTML } from './claude-design';

describe('landing page content', () => {
  it('builds the maintained copy instead of stale generated sections', () => {
    const header = SITE_HTML.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';

    expect(SITE_HTML).toContain('1.0 stable');
    expect(SITE_HTML).toContain('data-operator-console-section="true"');
    expect(SITE_HTML).toContain('Recover known ledger incidents safely.');
    expect(SITE_HTML).toContain('keeps the execution claim when the callback throws');
    expect(SITE_HTML).toContain('npm install @resvary/sdk @resvary/sqlite');
    expect(SITE_HTML).toContain('The published ledger is a read-only preview');
    expect(SITE_HTML).toContain('optional Mainnet or Testnet funding adapters');
    expect(SITE_HTML).toContain('Arc adapters support explicit Mainnet and Testnet configuration');
    expect(SITE_HTML).toContain('Synthetic example data');
    expect(SITE_HTML).toContain('09 / Operator Console');
    expect(SITE_HTML).toContain('10 / Get started');
    expect(SITE_HTML).toContain('11 / FAQ');
    expect(SITE_HTML).not.toContain('0.5 stable');
    expect(SITE_HTML).not.toContain('04 / Included in 0.5');
    expect(SITE_HTML).not.toContain('10 / Credit model');
    expect(SITE_HTML).not.toContain('data-credit-model-table');
    expect(SITE_HTML).not.toContain('Run the live demo');
    expect(SITE_HTML).not.toContain('Testnet-first development infrastructure');
    expect(SITE_HTML).not.toContain('Run the lifecycle in the demo');
    expect(header).not.toContain('>How it works</a>');
    expect(header).not.toContain('>Use cases</a>');
    expect(header).not.toContain('>GitHub</a>');
  });
});
