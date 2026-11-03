'use strict';
/**
 * CCH Grants Command Center: server (Smartsheet edition)
 *
 * - Serves the single-page app. Sign-in is not enabled yet (see lib/auth.js).
 * - Stores every record in Smartsheet: one sheet per collection (lib/schema.js), cached in memory (lib/store.js).
 * - Exposes a small REST API that public/shim.js uses to emulate the claude.ai "db" and "user"
 *   capabilities, so app/app.js runs unchanged.
 * - Who the user is comes from lib/auth.js (everyone is an editor for now).
 */
const express = require('express');
const path = require('path');
const { SmartsheetClient } = require('./lib/smartsheet');
const { Store } = require('./lib/store');
const { COLLECTIONS, LimitError } = require('./lib/schema');
const auth = require('./lib/auth');

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_DOC_BYTES = 64 * 1024;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadConfig(overrides) {
  return Object.assign({ identify: auth.identify }, overrides || {});
}

function createStore(overrides) {
  const e = process.env;
  if (!e.SMARTSHEET_ACCESS_TOKEN && !(overrides && overrides.token)) throw new Error('SMARTSHEET_ACCESS_TOKEN is required.');
  const o = overrides || {};
  const client = new SmartsheetClient({ token: o.token || e.SMARTSHEET_ACCESS_TOKEN, base: o.base || e.SMARTSHEET_API_BASE || undefined,
    rateLimitWaitMs: o.rateLimitWaitMs, backoffMs: o.backoffMs, perMinute: o.perMinute });
  let sheetIds = o.sheetIds;
  if (!sheetIds) {
    if (e.SHEET_IDS) { try { sheetIds = JSON.parse(e.SHEET_IDS); } catch (x) { throw new Error('SHEET_IDS is not valid JSON.'); } }
    else { try { sheetIds = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'sheets.json'), 'utf8')); } catch (x) { sheetIds = {}; } }
    delete sheetIds._note;
  }
  return new Store(client, { sheetIds, folderId: o.folderId || e.SMARTSHEET_FOLDER_ID, pollMs: o.pollMs || (parseInt(e.POLL_SECONDS, 10) || 20) * 1000, idleMs: o.idleMs,
    sheetPrefix: o.sheetPrefix, log: o.log });
}

function createApp(store, cfg) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('trust proxy', 1); // Render terminates TLS in front of the app

  // ---------- security headers ----------
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
        "img-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"].join('; '),
      'Strict-Transport-Security': 'max-age=15552000; includeSubDomains'
    });
    next();
  });

  // ---------- who is this? (see lib/auth.js) ----------
  const identify = (cfg && cfg.identify) || auth.identify;
  app.use((req, res, next) => { const u = identify(req); req.session = u ? { r: u.role, u: u.name, id: u.uid || u.name } : null; next(); });

  const needApi = (req, res, next) => (req.session ? next() : res.status(401).json({ error: 'Sign in required.' }));
  const needPage = (req, res, next) => (req.session ? next() : res.status(401).send('Sign-in required.'));
  const needEditor = (req, res, next) => (req.session && req.session.r === 'editor' ? next() : res.status(403).json({ error: 'Editor access required.' }));
  const needAjax = (req, res, next) => {
    if (req.get('x-requested-with') !== 'cch') return res.status(400).json({ error: 'Bad request.' });
    if (req.method !== 'DELETE' && !(req.get('content-type') || '').toLowerCase().startsWith('application/json')) return res.status(415).json({ error: 'JSON required.' });
    next();
  };
  const needReady = (req, res, next) => {
    if (store.ready) return next();
    res.set('Retry-After', '3');
    res.status(503).json({ error: store.initError ? 'Cannot reach Smartsheet: ' + store.initError : 'Starting up. Connecting to Smartsheet…' });
  };

  // ---------- health (no Smartsheet call, so it never burns API quota) ----------
  app.get('/healthz', (req, res) => res.json({ ok: true, ready: store.ready }));

  // ---------- app shell and assets ----------
  app.get('/shim.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shim.js')));
  app.get(['/', '/index.html'], needPage, (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(__dirname, 'app', 'index.html')); });
  app.get('/app.js', needPage, (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(__dirname, 'app', 'app.js')); });
  app.get('/import', needPage, (req, res) => { if (req.session.r !== 'editor') return res.status(403).send('Editor access required.'); res.sendFile(path.join(__dirname, 'public', 'import.html')); });
  app.get('/import.js', needPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'import.js')));
  app.get('/sheets', needPage, (req, res) => {
    const rows = store.status().map((s) => '<tr><td>' + (s.permalink ? '<a href="' + esc(s.permalink) + '" target="_blank" rel="noopener">' + esc(s.sheet) + '</a>' : esc(s.sheet)) + '</td><td>' + s.rows + '</td><td>' + (s.lastSync ? esc(new Date(s.lastSync).toISOString().slice(11, 19) + ' UTC') : '—') + '</td></tr>').join('');
    res.set('Cache-Control', 'no-store').type('html').send('<!DOCTYPE html><meta charset="utf-8"><title>Data in Smartsheet</title><body style="font-family:Arial,sans-serif;background:#f7f5f0;color:#12203a;padding:30px"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #d8d3c7;border-radius:14px;padding:24px 28px"><h1 style="font-size:22px;margin:0 0 8px">Data in Smartsheet</h1><p style="color:#5b6572;font-size:14px;line-height:1.5">Every record in this app is a row in one of these sheets. You can filter, report and share them in Smartsheet. Please do not rename or delete columns, or edit the <b>_id</b> and <b>_extra</b> columns.</p><table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="text-align:left;color:#5b6572"><th>Sheet</th><th>Rows</th><th>Last checked</th></tr>' + rows + '</table><p><a href="/" style="color:#5c4518">Back to the app</a></p></div></body>');
  });

  // ---------- API ----------
  const api = express.Router();
  api.use(needApi);
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); store.touch(); next(); });
  const checkColl = (req, res, next) => (COLLECTIONS[req.params.coll] ? next() : res.status(404).json({ error: 'Unknown collection.' }));
  const checkId = (req, res, next) => (ID_RE.test(req.params.id) ? next() : res.status(400).json({ error: 'Bad id.' }));
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const bodyDoc = (req, key) => { const d = req.body && req.body[key]; if (!isObj(d) || Buffer.byteLength(JSON.stringify(d)) > MAX_DOC_BYTES) return null; return d; };

  api.get('/me', (req, res) => res.json({ role: req.session.r, name: req.session.u, uid: req.session.id, ready: store.ready }));

  api.get('/c/:coll', needReady, checkColl, (req, res) => {
    const coll = req.params.coll;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 5000, 5000));
    const etag = store.etag(coll, limit);
    res.set('ETag', etag);
    if (req.get('if-none-match') === etag) return res.status(304).end();
    res.json({ docs: store.list(coll, limit) });
  });
  api.post('/c/:coll', needEditor, needAjax, needReady, checkColl, async (req, res, next) => {
    try { const data = bodyDoc(req, 'data'); if (!data) return res.status(400).json({ error: 'Invalid document.' }); res.status(201).json({ id: await store.add(req.params.coll, data) }); } catch (e) { next(e); }
  });
  api.put('/c/:coll/:id', needEditor, needAjax, needReady, checkColl, checkId, async (req, res, next) => {
    try { const data = bodyDoc(req, 'data'); if (!data) return res.status(400).json({ error: 'Invalid document.' }); await store.set(req.params.coll, req.params.id, data); res.json({ id: req.params.id }); } catch (e) { next(e); }
  });
  api.patch('/c/:coll/:id', needEditor, needAjax, needReady, checkColl, checkId, async (req, res, next) => {
    try {
      const patch = bodyDoc(req, 'patch'); if (!patch) return res.status(400).json({ error: 'Invalid patch.' });
      const r = await store.patch(req.params.coll, req.params.id, patch); if (r === null) return res.status(404).json({ error: 'Not found.' }); res.json({ id: r });
    } catch (e) { next(e); }
  });
  api.delete('/c/:coll/:id', needEditor, needAjax, needReady, checkColl, checkId, async (req, res, next) => {
    try { await store.remove(req.params.coll, req.params.id); res.status(204).end(); } catch (e) { next(e); }
  });

  api.get('/export', needEditor, needReady, (req, res) => {
    res.set('Content-Disposition', 'attachment; filename="cch-grants-export-' + new Date().toISOString().slice(0, 10) + '.json"');
    res.json({ exportedAt: new Date().toISOString(), ops: store.exportOps() });
  });
  api.post('/import', needEditor, needAjax, needReady, async (req, res, next) => {
    const ops = req.body && req.body.ops; const overwrite = !!(req.body && req.body.overwrite);
    if (!Array.isArray(ops) || ops.length > 20000) return res.status(400).json({ error: 'Expected {ops:[…]} with up to 20,000 items.' });
    const groups = {}; let rejected = 0;
    for (const o of ops) {
      const parts = String((o && o.path) || '').split('/');
      if (!o || o.op !== 'set' || parts.length !== 2 || !COLLECTIONS[parts[0]] || !ID_RE.test(parts[1]) || !isObj(o.data) || Buffer.byteLength(JSON.stringify(o.data)) > MAX_DOC_BYTES) { rejected++; continue; }
      (groups[parts[0]] = groups[parts[0]] || []).push({ id: parts[1], data: o.data });
    }
    try {
      let added = 0, skipped = 0;
      for (const [coll, items] of Object.entries(groups)) { const r = await store.importMany(coll, items, overwrite); added += r.added; skipped += r.skipped; }
      res.json({ added, skipped, rejected });
    } catch (e) { next(e); }
  });
  api.get('/status', needEditor, (req, res) => res.json({ ready: store.ready, requestsLastMinute: store.c.usedLastMinute(), sheets: store.status() }));

  app.use('/api', express.json({ limit: '8mb' }), api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return;
    const isApi = req.path.startsWith('/api');
    if (err instanceof LimitError) return res.status(413).json({ error: err.message });
    if (err && err.conflict) return res.status(409).json({ error: err.message });
    if (err && (err.status === 429 || err.retryable)) { console.error(err.message); return res.status(503).json({ error: 'Smartsheet is busy. Try again in a moment.' }); }
    if (err && err.status) { console.error(err.message); return res.status(502).json({ error: 'Smartsheet rejected the request.' }); }
    console.error(err);
    if (isApi) return res.status(500).json({ error: 'Server error.' });
    res.status(500).send('Server error.');
  });
  return app;
}

async function main() {
  const cfg = loadConfig();
  const store = createStore();
  const app = createApp(store, cfg);
  const port = parseInt(process.env.PORT, 10) || 3000;
  app.listen(port, () => console.log('CCH Grants Command Center listening on ' + port));
  // Connect to Smartsheet in the background so the web service starts (and passes health checks) right away.
  const connect = async () => {
    try { store.initError = null; await store.init(); console.log('Connected to Smartsheet. ' + Object.keys(COLLECTIONS).length + ' sheets ready.'); }
    catch (e) { store.initError = e.message; console.error('Smartsheet connection failed: ' + e.message + ' (retrying in 30s)'); setTimeout(connect, 30000); }
  };
  connect();
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { createApp, createStore, loadConfig };
