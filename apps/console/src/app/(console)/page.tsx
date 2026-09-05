import { Overview } from '@/components/overview';
import { getRuntime } from '@/lib/runtime';

export default async function OverviewPage() {
  const runtime = await getRuntime();
  const [overview, activity] = await Promise.all([
    runtime.admin.getOverview(runtime.config.projectId),
    runtime.admin.listAuditItems({ projectId: runtime.config.projectId, limit: 25 }),
  ]);
  const receipt = activity.items.find((item) => item.kind === 'usage_receipt');
  const evidence = receipt
    ? await runtime.admin.getUsageEvidence(runtime.config.projectId, receipt.id)
    : undefined;
  return (
    <Overview
      overview={overview}
      activity={activity}
      evidence={evidence}
      demoMode={runtime.config.demoMode}
    />
  );
}
