import { NextResponse } from 'next/server';
import { AuthError, requireApiSession } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';

type OperatorRequest = {
  actionId?: string;
  action?:
    | 'grant'
    | 'adjust'
    | 'expire_overdue'
    | 'requeue'
    | 'settle_operation'
    | 'reconcile_operation'
    | 'mark_operation_unknown'
    | 'confirm_not_executed';
  customerId?: string;
  eventId?: string;
  amount?: string;
  reason?: string;
  operationKey?: string;
  resultHash?: string;
  evidenceReference?: string;
};

export async function POST(request: Request) {
  try {
    await requireApiSession(request);
    const runtime = await getRuntime();
    if (runtime.config.demoMode) {
      return NextResponse.json(
        { error: 'Public demo mode is read-only; mutation routes are disabled' },
        { status: 403 },
      );
    }
    const body = (await request.json()) as OperatorRequest;
    const actionId = requireUuid(body.actionId);
    const reason = requireReason(body.reason);
    switch (body.action) {
      case 'settle_operation':
      case 'reconcile_operation': {
        const input = {
          actionId,
          reason,
          operationKey: requireText(body.operationKey, 'operationKey'),
          resultHash: requireText(body.resultHash, 'resultHash'),
        };
        return NextResponse.json(
          await (body.action === 'settle_operation'
            ? runtime.operator.settleOperation(input)
            : runtime.operator.reconcileOperation(input)),
        );
      }
      case 'mark_operation_unknown':
        return NextResponse.json(
          await runtime.operator.markOperationUnknown({
            actionId,
            reason,
            operationKey: requireText(body.operationKey, 'operationKey'),
          }),
        );
      case 'confirm_not_executed':
        return NextResponse.json(
          await runtime.operator.confirmOperationNotExecuted({
            actionId,
            reason,
            operationKey: requireText(body.operationKey, 'operationKey'),
            evidenceReference: requireText(body.evidenceReference, 'evidenceReference'),
          }),
        );
      case 'grant':
        return NextResponse.json(
          await runtime.operator.grantCredits({
            actionId,
            reason,
            customerId: requireText(body.customerId, 'customerId'),
            amount: requireText(body.amount, 'amount'),
          }),
        );
      case 'adjust':
        return NextResponse.json(
          await runtime.operator.adjustCredits({
            actionId,
            reason,
            customerId: requireText(body.customerId, 'customerId'),
            amount: requireText(body.amount, 'amount'),
          }),
        );
      case 'expire_overdue':
        return NextResponse.json(
          await runtime.operator.expireOverdueReservations({
            actionId,
            reason,
          }),
        );
      case 'requeue':
        return NextResponse.json(
          await runtime.operator.requeueDeadLetter({
            actionId,
            reason,
            eventId: requireText(body.eventId, 'eventId'),
          }),
        );
      default:
        return NextResponse.json({ error: 'Unknown operator action' }, { status: 400 });
    }
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Operator action failed' },
      { status },
    );
  }
}

function requireText(value: string | undefined, name: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function requireReason(value: string | undefined): string {
  const reason = requireText(value, 'reason');
  if (reason.length < 8 || reason.length > 500) {
    throw new Error('reason must contain between 8 and 500 characters');
  }
  return reason;
}

function requireUuid(value: string | undefined): string {
  const actionId = requireText(value, 'actionId');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actionId)
  ) {
    throw new Error('actionId must be a UUID');
  }
  return actionId;
}
