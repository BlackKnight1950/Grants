'use strict';
/**
 * One Smartsheet sheet per collection. Every field the app uses gets a real column,
 * so people can also read, filter and report on the data inside Smartsheet.
 *
 * Field kinds
 *   text   -> TEXT_NUMBER, always read back as a string
 *   number -> TEXT_NUMBER, read back as a number (blank = null)
 *   date   -> DATE (YYYY-MM-DD, blank = '')
 *   check  -> CHECKBOX (true/false)
 *   json   -> TEXT_NUMBER holding JSON (nested data such as the monthly spend plan)
 *
 * Two extra columns are added to every sheet:
 *   "_id"    the record id the app uses (do not edit)
 *   "_extra" JSON for any field the app adds in the future (do not edit)
 *
 * The first field of each collection becomes the sheet's primary column.
 * Column titles are the link between the app and the sheet: do not rename or delete them.
 * Adding your own columns, reordering, hiding, filtering, formatting and sharing are all safe.
 */
const f = (key, kind, title, extra) => Object.assign({ key, kind, title }, extra || {});
const T = (key, title) => f(key, 'text', title);
const N = (key, title) => f(key, 'number', title);
const D = (key, title) => f(key, 'date', title);
const C = (key, title) => f(key, 'check', title);
const J = (key, title, dflt) => f(key, 'json', title, { dflt });

const COLLECTIONS = {
  grants: { sheet: 'Grants', primaryTitle: 'Grant', fields: [
    T('name', 'Grant'), T('funder', 'Funder'), T('tier', 'Tier'), T('sponsor', 'Sponsor'), T('manager', 'Project manager'),
    N('amount', 'Award amount'), N('spentToDate', 'Spent to date'),
    D('startDate', 'Period start'), D('endDate', 'Period end'), D('totalStart', 'Award start'), D('totalEnd', 'Award end'), D('noaDate', 'NOA date'),
    C('hiring', 'Needs hiring'), C('existing', 'Existing staff'), C('subs', 'Subrecipients'), C('subs150', 'Contracts over $150k'),
    T('mode', 'Planning mode'), D('nextReport', 'Next report due'), T('nextReportType', 'Next report type'),
    T('boardNote', 'Board note'), T('continuity', 'Continuity plan'), T('notes', 'Notes'),
    N('periodBudget', 'Period budget'), N('rebudgetPct', 'Rebudget threshold %'), N('indirectRate', 'Indirect rate %'), N('personnelBudget', 'Personnel budget'),
    T('createdAt', 'Created'), J('dependsOn', 'Depends on (JSON)', []), J('spend', 'Monthly spend plan (JSON)', {})
  ] },
  tasks: { sheet: 'Tasks', primaryTitle: 'Task', fields: [
    T('title', 'Task'), T('grantId', 'Grant ID'), T('track', 'Track'), T('owner', 'Owner'), D('due', 'Due'), C('gate', 'Decision gate'), C('done', 'Done'), D('doneAt', 'Done on')
  ] },
  boardmeetings: { sheet: 'Board Meetings', primaryTitle: 'Meeting date', fields: [
    T('date', 'Meeting date'), D('submitBy', 'Submission cutoff'), T('note', 'Note')
  ] },
  positions: { sheet: 'Positions', primaryTitle: 'Position', fields: [
    T('title', 'Position'), T('grantId', 'Grant ID'), N('fte', 'FTE'), N('salary', 'Salary'), N('fringe', 'Fringe %'), D('needBy', 'Need by'), D('start', 'Expected start'), T('status', 'Status')
  ] },
  requests: { sheet: 'Requests', primaryTitle: 'Request', fields: [
    T('summary', 'Request'), T('grantId', 'Grant ID'), T('type', 'Type'), D('neededBy', 'Needed by'), D('submittedAt', 'Submitted'), T('ref', 'Reference #'), T('status', 'Status'), N('estCost', 'Estimated cost')
  ] },
  risks: { sheet: 'Risks', primaryTitle: 'Risk or issue', fields: [
    T('title', 'Risk or issue'), T('grantName', 'Grant or project'), T('type', 'Type'), T('statement', 'Statement'), T('prob', 'Probability'), T('impact', 'Impact'),
    T('owner', 'Owner'), T('response', 'Response'), T('plan', 'Action plan'), D('trigger', 'Trigger date'), T('status', 'Status'), D('lastReviewed', 'Last reviewed'), D('logged', 'Logged')
  ] },
  settings: { sheet: 'Settings', primaryTitle: 'Setting', fields: [] }, // whole document lives in _extra; primary = id
  budgetlines: { sheet: 'Budget Lines', primaryTitle: 'Category', fields: [
    T('category', 'Category'), T('grantId', 'Grant ID'), N('approved', 'Approved'), N('current', 'Current plan'), N('expended', 'Expended'), N('encumbered', 'Encumbered'), C('inBase', 'In indirect base'), T('note', 'Allowable-use note')
  ] },
  invoices: { sheet: 'Invoices', primaryTitle: 'Vendor or subrecipient', fields: [
    T('party', 'Vendor or subrecipient'), T('grantId', 'Grant ID'), T('invoiceNo', 'Invoice #'), N('amount', 'Amount'), D('invDate', 'Invoice date'), D('receivedDate', 'Received'), T('status', 'Status'), T('note', 'Note')
  ] },
  drawdowns: { sheet: 'Drawdowns', primaryTitle: 'Date', fields: [
    T('date', 'Date'), T('grantId', 'Grant ID'), N('amount', 'Amount'), T('method', 'Method'), T('status', 'Status'), T('note', 'Note')
  ] },
  timeeffort: { sheet: 'Time and Effort', primaryTitle: 'Staff member', fields: [
    T('staff', 'Staff member'), T('grantId', 'Grant ID'), T('role', 'Role'), N('pct', '% on grant'), T('period', 'Certification period'), D('due', 'Due'), T('status', 'Status'), D('certifiedAt', 'Certified on')
  ] },
  reports: { sheet: 'Reports', primaryTitle: 'Report', fields: [
    T('name', 'Report'), T('grantId', 'Grant ID'), T('freq', 'Frequency'), D('due', 'Due'), T('owner', 'Owner'), T('status', 'Status'), D('submittedAt', 'Submitted')
  ] },
  measures: { sheet: 'Performance Measures', primaryTitle: 'Measure', fields: [
    T('name', 'Measure'), T('grantId', 'Grant ID'), T('unit', 'Unit'), N('target', 'Target'), N('actual', 'Actual'), T('period', 'Period'), T('note', 'Note')
  ] },
  amendments: { sheet: 'Amendments', primaryTitle: 'Request', fields: [
    T('description', 'Request'), T('grantId', 'Grant ID'), T('type', 'Type'), D('neededBy', 'Decision needed by'), N('leadDays', 'Funder lead (days)'), D('submittedAt', 'Submitted'), T('status', 'Status'), D('approvedAt', 'Decision date')
  ] },
  subs: { sheet: 'Subrecipients', primaryTitle: 'Subrecipient', fields: [
    T('name', 'Subrecipient'), T('grantId', 'Grant ID'), T('uei', 'UEI'), N('amount', 'Subaward amount'), D('start', 'Start'), D('end', 'End'), T('risk', 'Risk'), D('riskDate', 'Risk assessed'),
    N('monitorFreq', 'Monitor every (months)'), D('lastMonitored', 'Last monitored'), T('agreementStatus', 'Agreement status'), T('notes', 'Notes')
  ] },
  monitoring: { sheet: 'Monitoring', primaryTitle: 'Review date', fields: [
    T('date', 'Review date'), T('grantId', 'Grant ID'), T('subId', 'Subrecipient ID'), T('type', 'Type'), T('findings', 'Findings'), D('followUpDue', 'Follow-up due'), T('status', 'Status')
  ] },
  opps: { sheet: 'Opportunities', primaryTitle: 'Opportunity', fields: [
    T('name', 'Opportunity'), T('funder', 'Funder'), T('nofo', 'NOFO or ALN'), D('deadline', 'Application due'), D('estAward', 'Est. award date'), N('amount', 'Request'), N('prob', 'Win %'),
    T('status', 'Stage'), T('lead', 'Lead'), N('termMonths', 'Term (months)'), C('hiring', 'Needs hiring'), C('existing', 'Existing staff'), C('subs', 'Subrecipients'), C('subs150', 'Contracts over $150k'),
    N('match', 'Match required %'), N('orate', 'Indirect rate %'), J('approvals', 'Sign-offs (JSON)', {}), J('obudget', 'Budget builder (JSON)', {})
  ] },
  templates: { sheet: 'Templates', primaryTitle: 'Template', fields: [
    T('name', 'Template'), T('funder', 'Funder'), T('tier', 'Tier'), N('termMonths', 'Term (months)'), C('hiring', 'Needs hiring'), C('existing', 'Existing staff'), C('subs', 'Subrecipients'), C('subs150', 'Contracts over $150k'),
    T('reportsText', 'Reports'), T('splitText', 'Budget split')
  ] },
  activity: { sheet: 'Activity Log', primaryTitle: 'What happened', fields: [
    T('text', 'What happened'), T('ts', 'Timestamp'), T('user', 'User'), T('grantId', 'Grant ID')
  ] }
};

const ID_COL = '_id';
const EXTRA_COL = '_extra';
const MAX_CELL = 4000;
const ZWSP = '​'; // guards against text that Smartsheet would read as a formula

function colType(kind) { return kind === 'date' ? 'DATE' : kind === 'check' ? 'CHECKBOX' : 'TEXT_NUMBER'; }

/** Columns for a brand-new sheet, primary first. */
function newSheetColumns(spec) {
  const cols = [{ title: spec.primaryTitle, type: 'TEXT_NUMBER', primary: true, width: 220 }];
  for (const fd of spec.fields) {
    if (fd.title === spec.primaryTitle) continue;
    cols.push({ title: fd.title, type: colType(fd.kind), width: fd.kind === 'check' ? 90 : 150 });
  }
  cols.push({ title: ID_COL, type: 'TEXT_NUMBER', width: 130 });
  cols.push({ title: EXTRA_COL, type: 'TEXT_NUMBER', width: 160 });
  return cols;
}

class LimitError extends Error {}

function encode(fd, v) {
  // returns {clear:true} or {value}
  if (fd.kind === 'check') return { value: v === true || v === 'true' };
  if (v === undefined || v === null || v === '') return { clear: true };
  if (fd.kind === 'number') { const n = Number(v); return Number.isFinite(n) ? { value: n } : { clear: true }; }
  if (fd.kind === 'date') { const s = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { value: s } : { clear: true }; }
  if (fd.kind === 'json') { const s = JSON.stringify(v); return guard(fd.title, s); }
  return guard(fd.title, String(v));
}
function guard(title, s) {
  if (s.length > MAX_CELL - 1) throw new LimitError('"' + title + '" is too long for a Smartsheet cell (' + s.length + ' of ' + MAX_CELL + ' characters).');
  return { value: /^[=]/.test(s) ? ZWSP + s : s };
}
function decode(fd, raw) {
  if (fd.kind === 'check') return raw === true;
  if (raw === undefined || raw === null || raw === '') {
    if (fd.kind === 'number') return null;
    if (fd.kind === 'json') return clone(fd.dflt);
    return '';
  }
  if (fd.kind === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : null; }
  if (fd.kind === 'date') return String(raw).slice(0, 10);
  let s = String(raw); if (s.charCodeAt(0) === 0x200b) s = s.slice(1);
  if (fd.kind === 'json') { try { return JSON.parse(s); } catch (e) { return clone(fd.dflt); } }
  return s;
}
const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

module.exports = { COLLECTIONS, ID_COL, EXTRA_COL, MAX_CELL, ZWSP, newSheetColumns, encode, decode, colType, LimitError, clone };
