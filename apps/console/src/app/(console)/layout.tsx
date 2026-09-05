import { requireSession } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';
import { Navigation } from '@/components/navigation';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const runtime = await getRuntime();
  return (
    <div className="console-shell r-app-shell">
      <aside className="sidebar">
        <div className="brand-block r-brand">
          <strong>RESVARY</strong>
          <span>OPERATOR CONSOLE</span>
          <span>v1.0.0</span>
        </div>
        <Navigation />
        <div className="sidebar-status">
          <div>
            <span className="status-square" /> All systems normal
          </div>
          <time dateTime={new Date().toISOString()}>
            {new Date().toISOString().slice(0, 19).replace('T', ' ')}
          </time>
          <dl>
            <div>
              <dt>Project</dt>
              <dd>{runtime.config.projectId}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{runtime.database}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{runtime.config.demoMode ? 'Synthetic data' : 'Live'}</dd>
            </div>
          </dl>
          <footer>
            <span>© 2026 Resvary Project</span>
            <span>Open Source (Apache-2.0)</span>
          </footer>
        </div>
      </aside>
      <div className="console-content">{children}</div>
    </div>
  );
}
