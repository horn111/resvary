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
