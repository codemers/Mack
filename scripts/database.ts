import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import type { Database, Statement } from '../packages/db/src/index';
export class LocalDatabase implements Database {
  sqlite: DatabaseSync;
  private runners = new WeakMap<Statement, () => unknown>();
  constructor(path = ':memory:') {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
    const directory = new URL('../packages/db/migrations/', import.meta.url);
    for (const name of readdirSync(directory)
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      if (this.sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)) continue;
      this.sqlite.exec('BEGIN');
      try {
        this.sqlite.exec(readFileSync(new URL(name, directory), 'utf8'));
        this.sqlite.prepare('INSERT INTO local_migrations(name) VALUES(?)').run(name);
        this.sqlite.exec('COMMIT');
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  }
  prepare(sql: string): Statement {
    const db = this.sqlite;
    let args: (string | number | bigint | Uint8Array | null)[] = [];
    const statement: Statement = {
      bind(...values: unknown[]) {
        args = values.map((v) => (v == null ? null : (v as string | number | bigint | Uint8Array)));
        return statement;
      },
      async first<T>() {
        return (db.prepare(sql).get(...args) as T) || null;
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...args) as T[] };
      },
      async run() {
        return db.prepare(sql).run(...args);
      },
    };
    this.runners.set(statement, () => db.prepare(sql).run(...args));
    return statement;
  }
  async batch(statements: Statement[]) {
    this.sqlite.exec('BEGIN');
    try {
      const result = [];
      for (const s of statements) result.push(this.runners.get(s)!());
      this.sqlite.exec('COMMIT');
      return result;
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    this.sqlite.close();
  }
}
