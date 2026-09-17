import { describe, expect, it } from 'vitest';
import { SITE_HTML } from './claude-design';

describe('landing page content', () => {
  it('builds the maintained copy instead of stale generated sections', () => {
    expect(SITE_HTML).toContain('1.0 stable');
    expect(SITE_HTML).toContain('data-operator-console-section="true"');
    expect(SITE_HTML).toContain('Recover known ledger incidents safely.');
    expect(SITE_HTML).toContain('keeps the execution claim when the callback throws');
    expect(SITE_HTML).not.toContain('0.5 stable');
    expect(SITE_HTML).not.toContain('04 / Included in 0.5');
  });
});
