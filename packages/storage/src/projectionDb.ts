import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** One anchored memory as the cache stores it. Hex values are lowercase strings. */
export interface AnchorRow {
  id: string;
  lane: number;
  signer: string;
  ns: string;
  structHash: string;
  parentsHash: string;
  bodyHash: string;
  cid: string;
  refBlock: string;
  block: string;
  logIndex: number;
}

export interface BlobRow {
  id: string;
  blob: string; // decrypted {header, body, signature} JSON
}

/** What recall may return: a memory visible in the projection, with its class for the context label. */
export interface RecallRow {
  id: string;
  cls: string;
  body: string;
}

/**
 * Local SQLite cache (spec section 4: "disposable index of verified envelopes, never a source of
 * truth"). `tyrell rebuild --fresh` deletes it and rebuilds from QIE and IPFS alone.
 *
 * Full-text search covers only memories the projection marks visible (verified, not quarantined),
 * so quarantined or unverified memories can never come back through recall (I-7).
 */
export class ProjectionDb {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS anchors (
        id TEXT PRIMARY KEY, lane INTEGER NOT NULL, signer TEXT NOT NULL, ns TEXT NOT NULL,
        struct_hash TEXT NOT NULL, parents_hash TEXT NOT NULL, body_hash TEXT NOT NULL, cid TEXT NOT NULL,
        ref_block TEXT NOT NULL, block TEXT NOT NULL, log_index INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, blob TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS visible (id TEXT PRIMARY KEY, cls TEXT NOT NULL, body TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS visible_fts USING fts5(id UNINDEXED, body);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS incidents (n INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
    `);
  }

  putAnchor(a: AnchorRow): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO anchors (id, lane, signer, ns, struct_hash, parents_hash, body_hash, cid, ref_block, block, log_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.lane, a.signer, a.ns, a.structHash, a.parentsHash, a.bodyHash, a.cid, a.refBlock, a.block, a.logIndex);
  }

  putBlob(id: string, blob: unknown): void {
    this.db.prepare("INSERT OR IGNORE INTO blobs (id, blob) VALUES (?, ?)").run(id, JSON.stringify(blob));
  }

  anchors(): AnchorRow[] {
    return this.db
      .prepare(
        `SELECT id, lane, signer, ns, struct_hash AS structHash, parents_hash AS parentsHash, body_hash AS bodyHash, cid,
                ref_block AS refBlock, block, log_index AS logIndex
         FROM anchors ORDER BY CAST(block AS INTEGER), log_index`,
      )
      .all() as unknown as AnchorRow[];
  }

  blob(id: string): unknown | undefined {
    const row = this.db.prepare("SELECT blob FROM blobs WHERE id = ?").get(id) as { blob: string } | undefined;
    return row ? JSON.parse(row.blob) : undefined;
  }

  /** Replaces the visible set and its full-text index in one transaction. */
  setVisible(rows: readonly RecallRow[]): void {
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM visible; DELETE FROM visible_fts;");
      const ins = this.db.prepare("INSERT INTO visible (id, cls, body) VALUES (?, ?, ?)");
      const fts = this.db.prepare("INSERT INTO visible_fts (id, body) VALUES (?, ?)");
      for (const r of rows) {
        ins.run(r.id, r.cls, r.body);
        fts.run(r.id, r.body);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Full-text recall over visible memories only. The query is passed as an FTS5 phrase list, not raw syntax. */
  search(query: string, limit = 8): RecallRow[] {
    const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (terms.length === 0) return [];
    const match = terms.map((t) => `"${t}"`).join(" OR ");
    return this.db
      .prepare(
        `SELECT v.id AS id, v.cls AS cls, v.body AS body FROM visible_fts f JOIN visible v ON v.id = f.id
         WHERE visible_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, limit) as unknown as RecallRow[];
  }

  isVisible(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM visible WHERE id = ?").get(id);
  }

  /**
   * Every cached memory body, with no projection: for the unprotected comparison agent only (FR-16).
   * Never used by Steward, whose recall goes through `search`.
   */
  allBodies(): Array<{ id: string; body: string }> {
    return (this.db.prepare("SELECT id, blob FROM blobs").all() as Array<{ id: string; blob: string }>).map((r) => ({ id: r.id, body: (JSON.parse(r.blob) as { body?: string }).body ?? "" }));
  }

  /** Sentinel incidents: local detection hints, not chain state (a rebuild starts without them). */
  addIncident(memoryId: string, incident: unknown): void {
    this.db.prepare("INSERT OR IGNORE INTO incidents (memory_id, json) VALUES (?, ?)").run(memoryId, JSON.stringify(incident));
  }

  incidents(): unknown[] {
    return (this.db.prepare("SELECT json FROM incidents ORDER BY n").all() as Array<{ json: string }>).map((r) => JSON.parse(r.json));
  }

  getMeta(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
