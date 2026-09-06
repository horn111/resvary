import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeReleaseNotes } from './release-notes.mjs';

describe('release notes', () => {
  it('normalizes platform-specific line endings before comparison', () => {
    const linuxNotes = '### Added\n\n- Operator Console\n- Audit Explorer\n';
    const windowsNotes = '### Added\r\n\r\n- Operator Console\r\n- Audit Explorer\r\n';

    assert.equal(normalizeReleaseNotes(windowsNotes), normalizeReleaseNotes(linuxNotes));
  });

  it('preserves meaningful content differences', () => {
    assert.notEqual(
      normalizeReleaseNotes('### Added\n\n- Operator Console'),
      normalizeReleaseNotes('### Added\n\n- Operator Dashboard'),
    );
  });
});
