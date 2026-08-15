import { ClaudeDesignController } from './claude-design-controller';
import { CLAUDE_DESIGN_HTML } from './claude-design.generated';
import styles from './claude-design.module.css';

export function ClaudeDesignPage() {
  return (
    <>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <div
        className={styles.claudeDesign}
        data-resvary-page="true"
        dangerouslySetInnerHTML={{ __html: CLAUDE_DESIGN_HTML }}
      />
      <ClaudeDesignController />
    </>
  );
}
