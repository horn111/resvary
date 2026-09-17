export class CreditError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InsufficientCreditsError extends CreditError {
  constructor(
    readonly availableUnits: string,
    readonly requiredUnits: string,
  ) {
    super(
      `Insufficient credits: available ${availableUnits}, required ${requiredUnits}`,
      'insufficient_credits',
    );
  }
}

export class IdempotencyConflictError extends CreditError {
  constructor(readonly idempotencyKey: string) {
    super(
      `Idempotency key was already used with a different request: ${idempotencyKey}`,
      'idempotency_conflict',
    );
  }
}

export class CreditNotFoundError extends CreditError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, 'not_found');
  }
}

export class InvalidCreditStateError extends CreditError {
  constructor(message: string) {
    super(message, 'invalid_state');
  }
}

export class MeteredExecutionAlreadyClaimedError extends CreditError {
  constructor(readonly reservationId: string) {
    super(
      `Metered execution was already claimed for reservation ${reservationId}; do not call the provider again. Reconcile the provider result and retry commitUsage directly.`,
      'metered_execution_already_claimed',
    );
  }
}

export class UnsupportedCreditStoreCapabilityError extends CreditError {
  constructor(capability = 'credit policies') {
    super(`Credit store does not support ${capability}`, 'unsupported_store_capability');
  }
}
