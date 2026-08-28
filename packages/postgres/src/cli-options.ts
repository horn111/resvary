export type PostgresCliOptions = Record<string, string | boolean>;

export function parsePostgresCliOptions(args: string[]): PostgresCliOptions {
  const valueOptions = new Set(['schema', 'sqlite']);
  const booleanOptions = new Set(['dry-run']);
  const options: PostgresCliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const separator = arg.indexOf('=');
    const key = arg.slice(2, separator === -1 ? undefined : separator);
    if (!valueOptions.has(key) && !booleanOptions.has(key)) {
      throw new Error(`Unknown option: --${key}`);
    }
    const inlineValue = separator === -1 ? undefined : arg.slice(separator + 1);
    const next = args[index + 1];
    if (booleanOptions.has(key)) {
      const candidate = inlineValue ?? (next === 'true' || next === 'false' ? next : undefined);
      if (candidate !== undefined && candidate !== 'true' && candidate !== 'false') {
        throw new Error(`--${key} must be true or false`);
      }
      options[key] = candidate === undefined ? true : candidate === 'true';
      if (inlineValue === undefined && candidate !== undefined) index += 1;
      continue;
    }
    const value = inlineValue ?? next;
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    options[key] = value;
    if (inlineValue === undefined) index += 1;
  }
  return options;
}
