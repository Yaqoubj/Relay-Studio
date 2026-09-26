import { DatabaseSync } from 'node:sqlite';
import { templates } from '../shared/catalog';
import type { Workflow, Run } from '../shared/types';
import { validateWorkflow } from './validation';
import type { OrganizationPlan, PlanItem, ScanResult, OrganizerState } from '../shared/organizer';
export class Store {
  db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, started TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS organization_ai_cache(key TEXT PRIMARY KEY, created TEXT NOT NULL, value TEXT NOT NULL);',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS organization_plans(id TEXT PRIMARY KEY, created TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS organization_items(plan_id TEXT NOT NULL, position INTEGER NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(plan_id,id));',
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS location_records(kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS library_files(id TEXT PRIMARY KEY, scope TEXT NOT NULL, path TEXT NOT NULL, search TEXT NOT NULL, seen TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS library_scope ON library_files(scope);
      CREATE INDEX IF NOT EXISTS library_path ON library_files(path);
    `);
    for (const entry of this.organizationHistory()) {
      if (['running', 'undoing'].includes(entry.status)) {
        const plan = this.organizationPlan(entry.id);
        plan.status = 'interrupted';
        plan.error =
          'The app closed during this batch. Inspect the recorded file states before undoing.';
        this.putOrganizationPlan(plan);
      }
    }
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
  records<T>(kind: string): T[] {
    return this.db
      .prepare('SELECT body FROM location_records WHERE kind=? ORDER BY rowid')
      .all(kind)
      .map((row) => JSON.parse(String(row.body)));
  }
  record(kind: string, id: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO location_records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body',
      )
      .run(kind, id, JSON.stringify(value));
  }
  removeRecord(kind: string, id: string) {
    this.db.prepare('DELETE FROM location_records WHERE kind=? AND id=?').run(kind, id);
  }
  getRecord<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare('SELECT body FROM location_records WHERE kind=? AND id=?')
      .get(kind, id);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  indexFile(file: import('../shared/organize-location').LibraryFile) {
    this.db
      .prepare(
        'INSERT INTO library_files(id,scope,path,search,seen,body) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET search=excluded.search,seen=excluded.seen,body=excluded.body',
      )
      .run(
        file.id,
        file.scopeId,
        file.path,
        `${file.relative}\n${file.category}\n${file.snippet}`.toLowerCase(),
        file.seen,
        JSON.stringify(file),
      );
  }
  indexedFile(id: string): import('../shared/organize-location').LibraryFile | undefined {
    const row = this.db.prepare('SELECT body FROM library_files WHERE id=?').get(id);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  searchLibrary(
    query: string,
    scope = '',
    offset = 0,
  ): import('../shared/organize-location').LibraryFile[] {
    const escaped = query.toLowerCase().replace(/[\\%_]/g, '\\$&');
    return this.db
      .prepare(
        "SELECT body FROM library_files WHERE (?='' OR scope=?) AND search LIKE ? ESCAPE '\\' ORDER BY path LIMIT 100 OFFSET ?",
      )
      .all(scope, scope, `%${escaped}%`, offset)
      .map((row) => JSON.parse(String(row.body)));
  }
  finishIndex(scope: string, seen: string) {
    this.db.prepare('DELETE FROM library_files WHERE scope=? AND seen<>?').run(scope, seen);
  }
  indexTotals(scope: string) {
    const row = this.db
      .prepare(
        "SELECT count(*) AS count, COALESCE(sum(json_extract(body,'$.size')),0) AS bytes FROM library_files WHERE scope=?",
      )
      .get(scope)!;
    return { count: Number(row.count), bytes: Number(row.bytes) };
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
  organizationScan(): ScanResult | null {
    return JSON.parse(this.get('organization-scan') || 'null');
  }
  aiCached(key: string): string | undefined {
    return this.db.prepare('SELECT value FROM organization_ai_cache WHERE key=?').get(key)
      ?.value as string | undefined;
  }
  cacheAI(key: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO organization_ai_cache(key,created,value) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET created=excluded.created,value=excluded.value',
      )
      .run(key, new Date().toISOString(), value);
    this.db.exec(
      'DELETE FROM organization_ai_cache WHERE key NOT IN (SELECT key FROM organization_ai_cache ORDER BY created DESC LIMIT 500)',
    );
  }
  putOrganizationScan(scan: ScanResult) {
    this.set('organization-scan', JSON.stringify(scan));
  }
  organizationPlan(id: string): OrganizationPlan {
    const row = this.db.prepare('SELECT body FROM organization_plans WHERE id=?').get(id);
    if (!row) throw new Error('Organization plan not found.');
    return {
      ...JSON.parse(String(row.body)),
      bundles:
        this.getRecord<OrganizationPlan['bundles']>('manifest', id) ||
        JSON.parse(String(row.body)).bundles,
      items: this.db
        .prepare('SELECT body FROM organization_items WHERE plan_id=? ORDER BY position')
        .all(id)
        .map((r) => JSON.parse(String(r.body))),
    };
  }
  putOrganizationPlan(plan: OrganizationPlan, item?: PlanItem, replaceItems = false) {
    const { items, bundles, ...metadata } = plan;
    this.db.exec('BEGIN');
    try {
      if (replaceItems && bundles) this.record('manifest', plan.id, bundles);
      this.db
        .prepare(
          'INSERT INTO organization_plans(id,created,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
        )
        .run(plan.id, plan.createdAt, JSON.stringify(metadata));
      if (replaceItems) {
        this.db.prepare('DELETE FROM organization_items WHERE plan_id=?').run(plan.id);
        const insert = this.db.prepare(
          'INSERT INTO organization_items(plan_id,position,id,body) VALUES(?,?,?,?)',
        );
        items.forEach((value, index) =>
          insert.run(plan.id, index, value.id, JSON.stringify(value)),
        );
      } else if (item)
        this.db
          .prepare('UPDATE organization_items SET body=? WHERE plan_id=? AND id=?')
          .run(JSON.stringify(item), plan.id, item.id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  organizationHistory(version?: 1 | 2): OrganizerState['history'] {
    return this.db
      .prepare(
        "SELECT id,body,(SELECT COUNT(*) FROM organization_items WHERE plan_id=organization_plans.id) AS count FROM organization_plans WHERE (? IS NULL OR json_extract(body,'$.version')=?) ORDER BY created DESC LIMIT 200",
      )
      .all(version ?? null, version ?? null)
      .map((row) => {
        const plan = JSON.parse(String(row.body)) as OrganizationPlan;
        return {
          id: plan.id,
          createdAt: plan.createdAt,
          template: plan.options.template,
          status: plan.status,
          count: Number(row.count),
        };
      });
  }
}
