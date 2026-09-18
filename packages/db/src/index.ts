export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
export interface Env {
  AI_GATEWAY_API_KEY?: string;
  DB: Database;
  ENCRYPTION_KEY: string;
  WEB_ORIGIN: string;
  GATEWAY_URL: string;
  DEMO_MODE?: string;
  DEV_REMOTE_ORIGIN?: string;
  MCP_ALLOWED_HOSTS?: string;
}
export const all = async <T>(db: Database, sql: string, ...args: unknown[]) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;
export const first = <T>(db: Database, sql: string, ...args: unknown[]) =>
  db
    .prepare(sql)
    .bind(...args)
    .first<T>();
export const run = (db: Database, sql: string, ...args: unknown[]) =>
  db
    .prepare(sql)
    .bind(...args)
    .run();
