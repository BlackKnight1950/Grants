document.getElementById('go').addEventListener('click', async function () {
  var out = document.getElementById('out'); out.style.display = 'block';
  var f = document.getElementById('file').files[0];
  if (!f) { out.textContent = 'Choose a JSON file first.'; return; }
  try {
    var j = JSON.parse(await f.text());
    var ops = Array.isArray(j) ? j : j.ops;
    out.textContent = 'Importing ' + (ops ? ops.length : 0) + ' records…';
    var r = await fetch('/api/import', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'cch' }, body: JSON.stringify({ ops: ops, overwrite: document.getElementById('over').checked }) });
    var res = await r.json();
    out.textContent = r.ok ? 'Done. Added ' + res.added + ', skipped ' + res.skipped + ' already present, rejected ' + res.rejected + '.' : 'Import failed: ' + (res.error || r.status);
  } catch (e) { out.textContent = 'That file could not be read as JSON.'; }
});
