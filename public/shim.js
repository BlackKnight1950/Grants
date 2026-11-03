/* Emulates the claude.ai "db" and "user" capabilities on top of this server's REST API,
   so app.js runs unchanged. Provides: claude.use('db'), claude.use('user').           */
(function () {
  'use strict';
  var HDR = { 'Content-Type': 'application/json', 'X-Requested-With': 'cch' };
  var POLL_MS = 5000;

  // ---------- small toast + account bar ----------
  function toast(msg) {
    try {
      var t = document.getElementById('cch-toast');
      if (!t) {
        t = document.createElement('div'); t.id = 'cch-toast';
        t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#b3432b;color:#fff;padding:10px 16px;border-radius:10px;font:14px Arial,sans-serif;z-index:9999;max-width:90vw;display:none;box-shadow:0 4px 14px rgba(0,0,0,.25)';
        document.body.appendChild(t);
      }
      t.textContent = msg; t.style.display = 'block';
      clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 5000);
    } catch (e) { /* ignore */ }
  }
  var mePromise = null;
  function me() {
    if (!mePromise) {
      mePromise = fetch('/api/me', { credentials: 'same-origin' }).then(function (r) {
        return r.json();
      });
    }
    return mePromise;
  }
  document.addEventListener('DOMContentLoaded', function () {
    me().then(function (m) {
      var bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;top:8px;right:12px;z-index:9000;font:12px Arial,sans-serif;background:rgba(255,255,255,.92);border:1px solid #d8d3c7;border-radius:999px;padding:5px 12px;color:#12203a';
      var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
      bar.innerHTML = esc(m.name) + (m.role === 'editor' ? '' : ' · view only') +
        (m.role === 'editor' ? ' · <a href="/import" style="color:#5c4518">Import</a> · <a href="/api/export" style="color:#5c4518">Backup</a>' : '') +
        ' · <a href="/sheets" style="color:#5c4518">Data in Smartsheet</a>';
      document.body.appendChild(bar);
    });
  });

  // ---------- HTTP ----------
  function call(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: HDR, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) {
        if (r.status === 401) { toast('Sign-in required.'); throw new Error('Sign-in required'); }
        if (r.status === 403) { toast('You have view-only access.'); throw new Error('view-only'); }
        if (!r.ok) { toast('Could not save (' + r.status + '). Try again.'); throw new Error('HTTP ' + r.status); }
        return r.status === 204 ? null : r.json();
      }, function (e) { toast('Network problem. Your change was not saved.'); throw e; });
  }

  // ---------- live collections (polling with ETag) ----------
  var watchers = {};
  function snapshot(docs) {
    return { docs: docs.map(function (d) { return { id: d.id, exists: true, data: function () { return JSON.parse(JSON.stringify(d.data)); } }; }) };
  }
  function refresh(key, force) {
    var w = watchers[key]; if (!w || !w.subs.length) return Promise.resolve();
    var headers = { 'X-Requested-With': 'cch' };
    if (w.etag && !force) headers['If-None-Match'] = w.etag;
    return fetch('/api/c/' + w.coll + (w.limit ? '?limit=' + w.limit : ''), { credentials: 'same-origin', headers: headers })
      .then(function (r) {
        if (r.status === 401) return null;
        if (r.status === 304) return null;
        if (!r.ok) throw new Error('HTTP ' + r.status);
        w.etag = r.headers.get('ETag');
        return r.json().then(function (j) { w.docs = j.docs; w.subs.slice().forEach(function (s) { s.cb(snapshot(j.docs)); }); });
      })
      .catch(function (e) { w.subs.forEach(function (s) { if (s.err) s.err(e); }); });
  }
  function refreshColl(coll) { Object.keys(watchers).forEach(function (k) { if (watchers[k].coll === coll) refresh(k, true); }); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) Object.keys(watchers).forEach(function (k) { refresh(k); }); });

  function collection(name) {
    var state = { limit: 0 };
    var q = {
      limit: function (n) { state.limit = n; return q; },
      orderBy: function () { return q; },
      onSnapshot: function (cb, err) {
        var key = name + ':' + state.limit; var w = watchers[key];
        if (!w) w = watchers[key] = { coll: name, limit: state.limit, subs: [], etag: null, timer: null, docs: null };
        var s = { cb: cb, err: err }; w.subs.push(s);
        if (!w.timer) w.timer = setInterval(function () { if (!document.hidden) refresh(key); }, POLL_MS);
        if (w.docs) setTimeout(function () { cb(snapshot(w.docs)); }, 0); else refresh(key, true);
        return function () { w.subs = w.subs.filter(function (x) { return x !== s; }); if (!w.subs.length) { clearInterval(w.timer); w.timer = null; } };
      },
      add: function (data) {
        return call('POST', '/api/c/' + name, { data: data }).then(function (r) { refreshColl(name); return { id: r.id, path: name + '/' + r.id }; });
      },
      doc: function (id) {
        var url = '/api/c/' + name + '/' + encodeURIComponent(id);
        return {
          id: id,
          set: function (data) { return call('PUT', url, { data: data }).then(function () { refreshColl(name); }); },
          update: function (patch) { return call('PATCH', url, { patch: patch }).then(function () { refreshColl(name); }); },
          delete: function () { return call('DELETE', url).then(function () { refreshColl(name); }); }
        };
      }
    };
    return q;
  }

  window.claude = {
    use: function (name) {
      if (name === 'db') return Promise.resolve({ collection: collection });
      if (name === 'user') return me().then(function (m) { return { can: function () { return Promise.resolve(m.role === 'editor'); }, id: function () { return Promise.resolve(m.uid); } }; });
      return Promise.resolve(null);
    }
  };
})();
