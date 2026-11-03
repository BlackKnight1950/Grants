'use strict';
/**
 * Checks that your token can open all 19 app sheets listed in sheets.json, and that Smartsheet
 * behaves the way the app expects. The behaviour test writes to a throwaway sheet, so it needs a
 * folder; it is skipped when SMARTSHEET_FOLDER_ID is not set.
 *
 *   SMARTSHEET_ACCESS_TOKEN=... [SMARTSHEET_FOLDER_ID=...] node scripts/doctor.js
 */
try { require('dotenv').config(); } catch (e) { /* optional */ }
const { SmartsheetClient } = require('../lib/smartsheet');

(async () => {
  const token = process.env.SMARTSHEET_ACCESS_TOKEN, folder = process.env.SMARTSHEET_FOLDER_ID;
  if (!token) { console.error('Set SMARTSHEET_ACCESS_TOKEN first.'); process.exit(1); }
  const c = new SmartsheetClient({ token, base: process.env.SMARTSHEET_API_BASE || undefined });
  let n = 0; const ok = (m) => console.log('  ✓ ' + m); const bad = (m) => { console.log('  ✗ ' + m); process.exitCode = 1; };
  let sheetId = null;
  try {
    const me = await c.get('/users/me'); ok('Token works. Signed in as ' + (me.email || me.name || 'unknown user'));
    let ids = {}; try { ids = require('../sheets.json'); } catch (x) { /* none */ }
    const { COLLECTIONS, ID_COL, EXTRA_COL } = require('../lib/schema');
    for (const [coll, spec] of Object.entries(COLLECTIONS)) {
      const ref = ids[coll]; if (!ref) { bad('No sheet ID for ' + coll + ' in sheets.json'); continue; }
      try {
        const g = await c.get('/sheets/' + ref.id, { page: 1, pageSize: 1 });
        const have = new Set(g.columns.map((x) => x.title)); const lack = spec.fields.map((f) => f.title).concat([ID_COL, EXTRA_COL]).filter((t) => !have.has(t));
        (lack.length ? bad : ok)(spec.sheet + ' (' + ref.id + ') opens' + (lack.length ? ', but is missing columns: ' + lack.join(', ') + ' (the app adds them on start if it can edit)' : ', columns OK'));
      } catch (e) { bad(spec.sheet + ' (' + ref.id + ') cannot be opened: ' + e.message); }
    }
    if (!folder) { console.log('\n  (Skipping the write test: set SMARTSHEET_FOLDER_ID to run it.)'); console.log(process.exitCode ? '\nSomething needs attention (see ✗ above).' : '\nAll good. You can deploy.'); return; }
    const kids = await c.get('/folders/' + folder + '/children', { childrenResourceTypes: 'sheets', maxItems: 5 }); ok('Folder is readable (' + (kids.data || []).length + ' sheet(s) on first page)');
    const made = await c.post('/folders/' + folder + '/sheets', { name: 'CCH Grants - doctor test (safe to delete)', columns: [
      { title: 'Name', type: 'TEXT_NUMBER', primary: true }, { title: 'Amount', type: 'TEXT_NUMBER' }, { title: 'When', type: 'DATE' }, { title: 'Flag', type: 'CHECKBOX' }, { title: 'Note', type: 'TEXT_NUMBER' }] });
    const res = made.result || made; sheetId = res.id; ok('Can create sheets in the folder');
    const cols = {}; for (const col of (res.columns || [])) cols[col.title] = col.id;
    if (!cols.Name) { const g = await c.get('/sheets/' + sheetId, { page: 1, pageSize: 1 }); for (const col of g.columns) cols[col.title] = col.id; }
    const add = await c.post('/sheets/' + sheetId + '/rows', [{ toBottom: true, cells: [
      { columnId: cols.Name, value: 'Row =1' }, { columnId: cols.Amount, value: 1234567.89 }, { columnId: cols.When, value: '2026-11-02' }, { columnId: cols.Flag, value: true }, { columnId: cols.Note, value: 'hello' }] }]);
    const rowId = add.result[0].id; ok('Can add rows');
    const v1 = (await c.get('/sheets/' + sheetId + '/version')).version; ok('Version endpoint works (version ' + v1 + ')');
    await c.put('/sheets/' + sheetId + '/rows', [{ id: rowId, cells: [{ columnId: cols.When, value: '', strict: false }, { columnId: cols.Note, value: '', strict: false }, { columnId: cols.Flag, value: false }, { columnId: cols.Amount, value: 5 }] }]);
    ok('Can update rows');
    const v2 = (await c.get('/sheets/' + sheetId + '/version')).version; (v2 !== v1 ? ok : bad)('Version changes after an update');
    const g = await c.get('/sheets/' + sheetId, { page: 1, pageSize: 100 });
    const row = g.rows[0]; const val = (t) => { const cell = row.cells.find((x) => x.columnId === cols[t]); return cell ? cell.value : undefined; };
    (val('When') === undefined || val('When') === null || val('When') === '' ? ok : bad)('Blank date clears with an empty string (got ' + JSON.stringify(val('When')) + ')');
    (val('Note') === undefined || val('Note') === null || val('Note') === '' ? ok : bad)('Blank text clears with an empty string (got ' + JSON.stringify(val('Note')) + ')');
    (val('Amount') === 5 ? ok : bad)('Numbers round-trip (got ' + JSON.stringify(val('Amount')) + ')');
    (val('Flag') !== true ? ok : bad)('Checkbox can be cleared');
    const str = await c.post('/sheets/' + sheetId + '/rows', [{ toBottom: true, cells: [{ columnId: cols.Name, value: '​=SUM(1,2)' }, { columnId: cols.Note, value: '2' }] }]);
    const g2 = await c.get('/sheets/' + sheetId, { page: 1, pageSize: 100 }); const r2 = g2.rows.find((r) => r.id === str.result[0].id);
    const nv = (t) => { const cell = r2.cells.find((x) => x.columnId === cols[t]); return cell ? cell.value : undefined; };
    (typeof nv('Note') === 'string' ? ok : bad)('Text "2" stays text (got ' + JSON.stringify(nv('Note')) + ')');
    (typeof nv('Name') === 'string' && String(nv('Name')).indexOf('SUM(1,2)') >= 0 && !String(nv('Name')).startsWith('=') ? ok : bad)('Text starting with = is kept as text, not a formula');
  } catch (e) { bad('Problem: ' + e.message); }
  finally { if (sheetId) { try { await c.del('/sheets/' + sheetId); ok('Test sheet deleted'); } catch (e) { bad('Could not delete the test sheet. Delete "CCH Grants - doctor test" by hand.'); } } }
  console.log(process.exitCode ? '\nSomething needs attention (see ✗ above).' : '\nAll good. You can deploy.');
})();
