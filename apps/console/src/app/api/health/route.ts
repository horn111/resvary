import { NextResponse } from 'next/server';
import { verifyAdminSecret } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization');
  const secret = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!verifyAdminSecret(secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const runtime = await getRuntime();
    await runtime.admin.getOverview(runtime.config.projectId);
    return NextResponse.json({
      ok: true,
      database: runtime.database,
      schemaVersion: runtime.schemaVersion,
      projectId: runtime.config.projectId,
      demoMode: runtime.config.demoMode,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
