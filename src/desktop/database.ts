import { DatabaseSync } from 'node:sqlite';
import { templates } from '../shared/catalog';
import type { Workflow, Run } from '../shared/types';
import { validateWorkflow } from './validation';
export class Store {
  db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, started TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);',
    );
    if (!this.get('initialized')) {
      for (const w of templates()) this.save(w);
      this.set('initialized', '1');
    }
    for (const run of this.runs())
      if (run.status === 'running') {
        run.status = 'interrupted';
        run.error = 'The app closed during this run. Inspect files before running again.';
        this.putRun(run);
      }
  }
  workflows(): Workflow[] {
    return this.db
      .prepare('SELECT body FROM workflows ORDER BY rowid')
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  workflow(id: string): Workflow {
    const row = this.db.prepare('SELECT body FROM workflows WHERE id=?').get(id);
    if (!row) throw new Error('Workflow not found.');
    return JSON.parse(String(row.body));
  }
  save(input: Workflow): Workflow {
    const w = validateWorkflow(input);
    w.updatedAt = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO workflows(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
      )
      .run(w.id, JSON.stringify(w));
    return w;
  }
  remove(id: string) {
    this.db.prepare('DELETE FROM workflows WHERE id=?').run(id);
  }
  runs(): Run[] {
    return this.db
      .prepare('SELECT body FROM runs ORDER BY started DESC LIMIT 100')
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  run(id: string): Run {
    const r = this.db.prepare('SELECT body FROM runs WHERE id=?').get(id);
    if (!r) throw new Error('Run not found.');
    return JSON.parse(String(r.body));
  }
  putRun(r: Run) {
    this.db
      .prepare(
        'INSERT INTO runs(id,started,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
      )
      .run(r.id, r.startedAt, JSON.stringify(r));
  }
  get(key: string): string | undefined {
    return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value as
      string | undefined;
  }
  set(key: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
  close() {
    this.db.close();
  }
}
