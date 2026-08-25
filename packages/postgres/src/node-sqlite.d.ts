declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): StatementSync;
    close(): void;
  }
  export interface StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }
}
