import { createRuntime } from '../src/lib/runtime';
import { isDeepStrictEqual } from 'node:util';
const rt = createRuntime();
try {
  if (rt.cfg.testMode) throw new Error('Fixture runs cannot produce live proof records');
  const id = process.argv[2];
  if (!id) throw new Error('Pass a completed live job UUID');
  const job = await rt.jobs.get(id);
  if (job.phase !== 'completed' || !job.receipt || !job.usage || !job.agent_usage)
    throw new Error('A completed agent run with saved usage is required');
  const reservation = await rt.ledger.getReservation(job.receipt.reservationId);
  const receipt = await rt.ledger.getUsageReceipt(job.receipt.id);
  if (
    !reservation ||
    !receipt ||
    reservation.status !== 'committed' ||
    !isDeepStrictEqual(receipt, job.receipt)
  )
    throw new Error('Ledger verification failed');
  if (
    BigInt(receipt.amountUnits) + BigInt(receipt.releasedUnits) !==
    BigInt(reservation.reservedUnits)
  )
    throw new Error('Receipt conservation failed');
  const funded = job.challenge
    ? await rt.ledger.listFundingTransactions(job.challenge.fundingIntent.id)
    : [];
  if (job.challenge && (funded.length !== 1 || funded[0].settlementStatus !== 'settled'))
    throw new Error('Funding verification failed');
  if (funded.some((tx) => String(tx.evidence?.facilitatorReference).startsWith('TEST_FIXTURE_')))
    throw new Error('Fixture settlement cannot be published as live proof');
  // Allowlist output fields. Never output document, result, signature, session or credentials.
  console.log(
    JSON.stringify(
      {
        schema: 'resvary-agent-proof-v1',
        network: 'eip155:5042002',
        jobId: id,
        createdAt: job.created_at.toISOString(),
        reservationId: reservation.id,
        receiptId: receipt.id,
        reserved: reservation.reservedAmount,
        charged: receipt.amount,
        released: receipt.releasedAmount,
        balanceAfterUnits: receipt.balanceAfterUnits,
        serviceUsage: job.usage,
        agentUsage: job.agent_usage,
        models: job.ai_config,
        funding: funded.map((tx) => ({
          fundingIntentId: tx.fundingIntentId,
          fundingTransactionId: tx.id,
          amount: tx.amount,
          gatewayTransferId:
            typeof tx.evidence?.facilitatorReference === 'string' &&
            /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tx.evidence.facilitatorReference)
              ? tx.evidence.facilitatorReference
              : undefined,
          transactionHash:
            typeof tx.txHash === 'string' && /^0x[0-9a-f]{64}$/i.test(tx.txHash)
              ? tx.txHash
              : undefined,
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await rt.pool.end();
}
