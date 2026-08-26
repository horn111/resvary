import { ClaudeDesignController } from './claude-design-controller';
import { CLAUDE_DESIGN_HTML } from './claude-design.generated';
import styles from './claude-design.module.css';

const FOOTER_ISSUES_LINK =
  '<a href="https://github.com/horn111/resvary/issues" style="transition:color .2s">Issues</a>';
const FOOTER_X_LINK =
  '<a href="https://x.com/resvaryAI" rel="me" style="transition:color .2s">X / Twitter</a>';
const SITE_HTML = CLAUDE_DESIGN_HTML.replace(
  FOOTER_ISSUES_LINK,
  `${FOOTER_ISSUES_LINK}\n        ${FOOTER_X_LINK}`,
);

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
