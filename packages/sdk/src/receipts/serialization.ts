const BIGINT_MARKER = '__resvaryBigInt';

type SerializedBigInt = {
  [BIGINT_MARKER]: string;
};

export function serializeReceiptStoreValue(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') {
      return { [BIGINT_MARKER]: item.toString() } satisfies SerializedBigInt;
    }

    return item;
  });
}

export function parseReceiptStoreValue<T>(value: string): T {
  return JSON.parse(value, (_key, item: unknown) => {
    if (isSerializedBigInt(item)) {
      return BigInt(item[BIGINT_MARKER]);
    }

    return item;
  }) as T;
}

function isSerializedBigInt(value: unknown): value is SerializedBigInt {
  return Boolean(
    value &&
    typeof value === 'object' &&
    BIGINT_MARKER in value &&
    typeof (value as SerializedBigInt)[BIGINT_MARKER] === 'string',
  );
}
