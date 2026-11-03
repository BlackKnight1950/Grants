'use strict';
/**
 * Document store on top of Smartsheet.
 *
 * - One sheet per collection (see schema.js); one row per record.
 * - The whole store is cached in memory. Reads never touch Smartsheet.
 * - Writes go to Smartsheet first, then update the cache. Writes to the same sheet are
 *   queued one at a time (Smartsheet rejects concurrent updates to one sheet).
 * - A light poll compares each sheet's version number and reloads only sheets that changed,
 *   so edits people make directly in Smartsheet show up in the app. Polling pauses when nobody
 *   is using the app.
 * - Rows someone adds by hand in Smartsheet (no _id) are adopted: they get an id written back.
 */
const crypto = require('crypto');
const { COLLECTIONS, ID_COL, EXTRA_COL, MAX_CELL, newSheetColumns, encode, decode, colType, LimitError, clone } = require('./schema');

const PAGE_SIZE = 5000;
const BATCH = 500;           // Smartsheet: at most 500 rows per add/update request
const DELETE_BATCH = 100;
const ACTIVITY_KEEP = 3000, ACTIVITY_MAX = 3500;
const newId = () => crypto.randomBytes(10).toString('hex');

class Store {
  constructor(client, opts) {
    const o = opts || {};
    this.c = client;
    this.folderId = String(o.folderId || '');
    this.sheetIds = o.sheetIds || {};   // { collection: id | {id, permalink} } - explicit IDs skip folder discovery
    this.prefix = o.sheetPrefix != null ? o.sheetPrefix : 'CCH Grants - ';
    this.pollMs = o.pollMs || 20000;
    this.idleMs = o.idleMs || 5 * 60 * 1000;
    this.log = o.log || console;
    this.st = {};
    this.ready = false;
    this.initError = null;
    this.lastTouch = Date.now();
    for (const [coll, spec] of Object.entries(COLLECTIONS)) {
      this.st[coll] = { coll, spec, name: this.prefix + spec.sheet, sheetId: null, permalink: '', colIds: {}, idCol: null, extraCol: null, primaryCol: null,
        docs: new Map(), version: null, hash: '', rev: 0, queue: Promise.resolve(), lastSync: 0, timer: null };
    }
  }

  // ---------- lifecycle ----------
  async init() {
    const given = (coll) => { const v = this.sheetIds[coll]; return v == null ? null : (typeof v === 'object' ? { id: String(v.id), permalink: v.permalink || '' } : { id: String(v), permalink: '' }); };
    const missing = Object.keys(this.st).filter((c) => !given(c));
    if (missing.length && !this.folderId) throw new Error('No sheet ID for: ' + missing.join(', ') + '. Add them to sheets.json (or SHEET_IDS), or set SMARTSHEET_FOLDER_ID so the app can create them.');
    const existing = missing.length ? await this.listFolderSheets() : new Map();
    for (const st of Object.values(this.st)) {
      let info = given(st.coll);
      if (!info) {
        info = existing.get(st.name);
        if (!info) {
          const r = await this.c.post('/folders/' + this.folderId + '/sheets', { name: st.name, columns: newSheetColumns(st.spec) });
          const res = r.result || r;
          if (!res || res.id == null) throw new Error('Smartsheet did not return the new sheet for "' + st.name + '".');
          info = { id: res.id, permalink: res.permalink || '' };
          this.log.log('Created sheet: ' + st.name);
        }
      }
      st.sheetId = info.id; st.permalink = info.permalink || '';
      try { await this.enqueue(st.coll, () => this.reload(st.coll, true)); }
      catch (e) { throw new Error('Cannot open sheet "' + st.name + '" (ID ' + st.sheetId + '): ' + e.message + '. Check the ID and that the token\'s user has Editor access to the sheet.'); }
    }
    this.ready = true;
    this.startPolling();
  }

  close() { for (const st of Object.values(this.st)) { clearTimeout(st.timer); st.timer = null; } this.closed = true; }

  async listFolderSheets() {
    const out = new Map(); let lastKey;
    for (let i = 0; i < 50; i++) {
      const r = await this.c.get('/folders/' + this.folderId + '/children', { childrenResourceTypes: 'sheets', maxItems: 100, lastKey });
      for (const it of (r.data || [])) if (it.resourceType === 'sheet' && !out.has(it.name)) out.set(it.name, { id: it.id, permalink: it.permalink });
      if (!r.lastKey) break; lastKey = r.lastKey;
    }
    return out;
  }

  enqueue(coll, fn) {
    const st = this.st[coll];
    const run = st.queue.then(() => fn());
    st.queue = run.catch(() => {});
    return run;
  }

  // ---------- polling ----------
  isActive() { return Date.now() - this.lastTouch < this.idleMs; }
  touch() {
    const was = this.isActive(); this.lastTouch = Date.now();
    if (!was && this.ready) this.pollAll();
  }
  async pollAll() { for (const st of Object.values(this.st)) { try { await this.enqueue(st.coll, () => this.checkVersion(st.coll)); } catch (e) { this.log.error('poll ' + st.coll + ': ' + e.message); } } }
  startPolling() {
    const names = Object.keys(this.st);
    names.forEach((coll, i) => {
      const st = this.st[coll];
      const tick = async () => {
        if (this.closed) return;
        try { if (this.isActive()) await this.enqueue(coll, () => this.checkVersion(coll)); }
        catch (e) { this.log.error('poll ' + coll + ': ' + e.message); }
        if (!this.closed) st.timer = setTimeout(tick, this.pollMs);
      };
      st.timer = setTimeout(tick, Math.floor(this.pollMs * i / names.length) + 50);
    });
  }
  async checkVersion(coll) {
    const st = this.st[coll];
    // Keep headroom for people's edits: skip background checks when most of the minute's request budget is already used.
    if (this.c.usedLastMinute() > this.c.perMinute * 0.7) return;
    const v = await this.c.get('/sheets/' + st.sheetId + '/version');
    if (v.version !== st.version) await this.reload(coll, false, v);
    else st.lastSync = Date.now();
  }

  // ---------- loading ----------
  mapColumns(st, columns) {
    st.colIds = {}; let primary = null;
    for (const c of columns) { st.colIds[c.title] = c.id; if (c.primary) primary = c; }
    st.primaryCol = primary ? primary.id : null;
    if (primary) st.colIds[st.spec.primaryTitle] = primary.id; // survives a renamed primary column
    st.idCol = st.colIds[ID_COL]; st.extraCol = st.colIds[EXTRA_COL];
  }

  async ensureColumns(st, columns) {
    const need = [];
    for (const fd of st.spec.fields) { if (st.colIds[fd.title] == null) need.push({ title: fd.title, type: colType(fd.kind) }); }
    if (st.idCol == null) need.push({ title: ID_COL, type: 'TEXT_NUMBER' });
    if (st.extraCol == null) need.push({ title: EXTRA_COL, type: 'TEXT_NUMBER' });
    if (!need.length) return;
    const body = need.map((c, i) => Object.assign({ index: columns.length + i }, c));
    await this.c.post('/sheets/' + st.sheetId + '/columns', body);
    this.log.log('Added ' + need.length + ' missing column(s) to "' + st.name + '"');
    const r = await this.c.get('/sheets/' + st.sheetId, { page: 1, pageSize: 1 });
    this.mapColumns(st, r.columns || []);
  }

  async reload(coll, ensure, knownVersion) {
    const st = this.st[coll];
    const ver = knownVersion || await this.c.get('/sheets/' + st.sheetId + '/version');
    const rows = []; const seen = new Set(); let columns = null; let page = 1;
    for (;;) {
      const r = await this.c.get('/sheets/' + st.sheetId, { page, pageSize: PAGE_SIZE });
      columns = r.columns || columns;
      let fresh = 0;
      for (const row of (r.rows || [])) if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); fresh++; }
      if (!fresh) break;
      if (r.totalRowCount !== undefined && rows.length >= r.totalRowCount) break;
      if (r.totalPages !== undefined && page >= r.totalPages) break;
      if (++page > 400) break;
    }
    this.mapColumns(st, columns || []);
    if (ensure) await this.ensureColumns(st, columns || []);

    const docs = new Map(); const adopt = [];
    for (const row of rows) {
      const cells = new Map(); for (const c of (row.cells || [])) cells.set(c.columnId, c.value);
      const hasData = [...cells.values()].some((v) => v !== undefined && v !== null && v !== '');
      if (!hasData) continue;
      let id = cells.get(st.idCol); id = id == null ? '' : String(id).trim();
      if (!id || docs.has(id)) { id = newId(); adopt.push({ rowId: row.id, id }); }
      const data = {};
      for (const fd of st.spec.fields) { const cid = st.colIds[fd.title]; data[fd.key] = decode(fd, cid != null ? cells.get(cid) : undefined); }
      const ex = st.extraCol != null ? cells.get(st.extraCol) : null;
      if (ex) { try { Object.assign(data, JSON.parse(String(ex))); } catch (e) { /* ignore bad JSON */ } }
      docs.set(id, { rowId: row.id, data, seq: Date.parse(row.modifiedAt) || 0 });
    }
    const hash = crypto.createHash('sha1').update(JSON.stringify([...docs.entries()].map(([id, d]) => [id, d.data]).sort((a, b) => (a[0] < b[0] ? -1 : 1)))).digest('hex');
    st.docs = docs;
    if (hash !== st.hash) { st.hash = hash; st.rev++; }
    st.version = ver.version; st.lastSync = Date.now();

    if (adopt.length && st.idCol != null) {
      try {
        for (let i = 0; i < adopt.length; i += BATCH) {
          const part = adopt.slice(i, i + BATCH);
          await this.c.put('/sheets/' + st.sheetId + '/rows', part.map((a) => ({ id: a.rowId, cells: [{ columnId: st.idCol, value: a.id }] })));
        }
        this.log.log('Adopted ' + adopt.length + ' row(s) added by hand in "' + st.name + '"');
      } catch (e) { this.log.error('adopt ' + coll + ': ' + e.message); }
    }
  }

  // ---------- reads ----------
  list(coll, limit) {
    const arr = [...this.st[coll].docs.entries()].map(([id, d]) => ({ id, data: d.data, seq: d.seq }));
    arr.sort((a, b) => b.seq - a.seq || (a.id < b.id ? -1 : 1));
    return arr.slice(0, limit || 5000).map((d) => ({ id: d.id, data: d.data }));
  }
  etag(coll, limit) { return '"' + this.st[coll].rev + '-' + (limit || 5000) + '"'; }
  has(coll) { return !!this.st[coll]; }
  status() {
    return Object.values(this.st).map((s) => ({ collection: s.coll, sheet: s.name, permalink: s.permalink, rows: s.docs.size, version: s.version, lastSync: s.lastSync }));
  }
  exportOps() {
    const ops = [];
    for (const st of Object.values(this.st)) for (const [id, d] of st.docs) ops.push({ op: 'set', path: st.coll + '/' + id, data: d.data });
    return ops;
  }

  // ---------- writes ----------
  bump(st) { st.rev++; st.hash = ''; }
  normalize(st, data) {
    const out = {};
    for (const fd of st.spec.fields) { const e = encode(fd, data[fd.key]); out[fd.key] = decode(fd, e.clear ? undefined : e.value); }
    const known = new Set(st.spec.fields.map((f) => f.key));
    for (const k of Object.keys(data)) if (!known.has(k) && data[k] !== undefined) out[k] = clone(data[k]);
    return out;
  }
  cells(st, data, keys, forNew) {
    const spec = st.spec; const cells = []; const known = new Set(spec.fields.map((f) => f.key));
    for (const fd of spec.fields) {
      if (keys && !keys.has(fd.key)) continue;
      const colId = st.colIds[fd.title]; if (colId == null) continue;
      const e = encode(fd, data[fd.key]);
      if (e.clear) { if (!forNew) cells.push({ columnId: colId, value: '', strict: false }); }
      else cells.push({ columnId: colId, value: e.value });
    }
    if (!keys || [...keys].some((k) => !known.has(k))) {
      const ex = {}; for (const k of Object.keys(data)) if (!known.has(k) && data[k] !== undefined) ex[k] = data[k];
      const s = Object.keys(ex).length ? JSON.stringify(ex) : '';
      if (s.length > MAX_CELL - 1) throw new LimitError('Extra fields are too long for a Smartsheet cell.');
      if (s) cells.push({ columnId: st.extraCol, value: s }); else if (!forNew) cells.push({ columnId: st.extraCol, value: '', strict: false });
    }
    return cells;
  }
  newRow(st, id, data) {
    const cells = this.cells(st, data, null, true);
    cells.push({ columnId: st.idCol, value: id });
    if (!st.spec.fields.length && st.primaryCol != null) cells.push({ columnId: st.primaryCol, value: id });
    return { toBottom: true, cells };
  }
  async stale(st, e) {
    if (e && (e.status === 404 || e.errorCode === 1006)) { try { await this.reload(st.coll, false); } catch (x) { /* ignore */ } const err = new Error('That record changed in Smartsheet. Refresh and try again.'); err.conflict = true; throw err; }
    throw e;
  }

  add(coll, data, id) { id = id || newId(); return this.enqueue(coll, () => this._add(coll, id, data)); }
  async _add(coll, id, data) {
    const st = this.st[coll]; const row = this.newRow(st, id, data);
    const r = await this.c.post('/sheets/' + st.sheetId + '/rows', [row]);
    const made = (r.result || [])[0];
    if (!made || made.id == null) throw new Error('Smartsheet did not return the new row.');
    st.docs.set(id, { rowId: made.id, data: this.normalize(st, data), seq: Date.now() });
    this.bump(st);
    if (coll === 'activity' && st.docs.size > ACTIVITY_MAX) this.prune(st).catch((e) => this.log.error('prune: ' + e.message));
    return id;
  }
  set(coll, id, data) {
    return this.enqueue(coll, async () => {
      const st = this.st[coll]; const ex = st.docs.get(id);
      if (!ex) return this._add(coll, id, data);
      const cells = this.cells(st, data, null, false);
      try { await this.c.put('/sheets/' + st.sheetId + '/rows', [{ id: ex.rowId, cells }]); } catch (e) { await this.stale(st, e); }
      st.docs.set(id, { rowId: ex.rowId, data: this.normalize(st, data), seq: Date.now() }); this.bump(st); return id;
    });
  }
  patch(coll, id, patch) {
    return this.enqueue(coll, async () => {
      const st = this.st[coll]; const ex = st.docs.get(id); if (!ex) return null;
      const merged = Object.assign({}, ex.data, patch);
      const cells = this.cells(st, merged, new Set(Object.keys(patch)), false);
      if (cells.length) { try { await this.c.put('/sheets/' + st.sheetId + '/rows', [{ id: ex.rowId, cells }]); } catch (e) { await this.stale(st, e); } }
      st.docs.set(id, { rowId: ex.rowId, data: this.normalize(st, merged), seq: Date.now() }); this.bump(st); return id;
    });
  }
  remove(coll, id) {
    return this.enqueue(coll, async () => {
      const st = this.st[coll]; const ex = st.docs.get(id); if (!ex) return;
      await this.c.del('/sheets/' + st.sheetId + '/rows', { ids: ex.rowId, ignoreRowsNotFound: true });
      st.docs.delete(id); this.bump(st);
    });
  }

  /** Bulk import for one collection. items: [{id, data}]. */
  importMany(coll, items, overwrite) {
    return this.enqueue(coll, async () => {
      const st = this.st[coll]; let added = 0, skipped = 0;
      const toAdd = [], toUpdate = [];
      for (const it of items) {
        const ex = st.docs.get(it.id);
        if (!ex) toAdd.push(it); else if (overwrite) toUpdate.push({ it, ex }); else skipped++;
      }
      for (let i = 0; i < toAdd.length; i += BATCH) {
        const part = toAdd.slice(i, i + BATCH);
        const r = await this.c.post('/sheets/' + st.sheetId + '/rows', part.map((it) => this.newRow(st, it.id, it.data)));
        const made = r.result || [];
        if (made.length !== part.length) throw new Error('Smartsheet returned ' + made.length + ' rows for ' + part.length + ' added.');
        part.forEach((it, k) => st.docs.set(it.id, { rowId: made[k].id, data: this.normalize(st, it.data), seq: Date.now() }));
        added += part.length;
      }
      for (let i = 0; i < toUpdate.length; i += BATCH) {
        const part = toUpdate.slice(i, i + BATCH);
        await this.c.put('/sheets/' + st.sheetId + '/rows', part.map((u) => ({ id: u.ex.rowId, cells: this.cells(st, u.it.data, null, false) })));
        part.forEach((u) => st.docs.set(u.it.id, { rowId: u.ex.rowId, data: this.normalize(st, u.it.data), seq: Date.now() }));
        added += part.length;
      }
      if (added) this.bump(st);
      return { added, skipped };
    });
  }

  async prune(st) {
    await this.enqueue(st.coll, async () => {
      const arr = [...st.docs.entries()].sort((a, b) => String(a[1].data.ts || '').localeCompare(String(b[1].data.ts || '')));
      const drop = arr.slice(0, Math.max(0, arr.length - ACTIVITY_KEEP));
      for (let i = 0; i < drop.length; i += DELETE_BATCH) {
        const part = drop.slice(i, i + DELETE_BATCH);
        await this.c.del('/sheets/' + st.sheetId + '/rows', { ids: part.map((p) => p[1].rowId).join(','), ignoreRowsNotFound: true });
        part.forEach((p) => st.docs.delete(p[0]));
      }
      this.bump(st);
    });
  }
}

module.exports = { Store, newId };
