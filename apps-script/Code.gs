/**
 * Barcheck backend: Google Apps Script Web App storing records in a Google Sheet.
 *
 * Layout of this file
 *  1. Constants
 *  2. PURE logic (no Google APIs): handleRequest, rowsToSheetValues, sheetValuesToRecords.
 *     Unit-tested in Vitest (apps-script/Code.test.ts) by evaluating this file in node:vm
 *     with a sandbox that has no Google globals.
 *  3. THIN GOOGLE WRAPPERS at the bottom: doPost, setup, makeSheetStore.
 *     These use SpreadsheetApp / LockService / ContentService / Utilities / PropertiesService
 *     and are NOT unit-tested. They are verified manually by the owner (see setup notes).
 *
 * Protocol (POST body is a JSON string, sent as text/plain):
 *   push  {action,barId,key,form:'report'|'req',date,rows,meta}
 *         Replaces ALL rows of (form,bar,date). rows:[] DELETES the rows; the record then
 *         disappears (the record-level meta lives on the rows, so nothing is kept).
 *   load  {action,barId,key,month:'YYYY-MM'}  -> {ok,reports,reqs}
 *   items {action,barId,key}                  -> {ok,items}
 *   Errors: {ok:false,error:'unauthorized'|'bad_request'|'server_error'}
 *
 * Plain V8 JS only: no import/export, no TypeScript.
 */

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

const BAR_IDS = ['the-cove', 'mango', 'coconut', 'fm', 'ct', 'palm', 'pn', 'pf-bb', 'bc', 'th-saya', 'pipin', 'ray-bar'];

// Filled by the Task 6 build script. Each entry: {code,name,category,form,sizeOz,active}.
const ITEMS_SEED = [];

const REPORT_HEADERS = ['barId', 'date', 'itemCode', 'itemName', 'category', 'sizeOz', 'openBtl', 'openOz',
  'dailyStoreOz', 'transferInOz', 'transferOutOz', 'saleOz', 'countedBtl', 'countedOz', 'remark', 'openFrom',
  'status', 'reportBy', 'updatedAt'];
const REQ_HEADERS = ['barId', 'date', 'itemCode', 'itemName', 'qty', 'requestedBy', 'approvedBy', 'issuedBy',
  'status', 'updatedAt'];
const ITEM_HEADERS = ['code', 'name', 'category', 'form', 'sizeOz', 'active'];
const KEY_HEADERS = ['barId', 'key'];

const MAX_BODY_CHARS = 1000000;
const MAX_ROWS = 500;
const MAX_TEXT = 2000;

// Report column indexes (0-based).
const RC = { barId: 0, date: 1, itemCode: 2, itemName: 3, category: 4, sizeOz: 5, openBtl: 6, openOz: 7,
  dailyStore: 8, transferIn: 9, transferOut: 10, sale: 11, countedBtl: 12, countedOz: 13, remark: 14,
  openFrom: 15, status: 16, reportBy: 17, updatedAt: 18 };
// Requisition column indexes.
const QC = { barId: 0, date: 1, itemCode: 2, itemName: 3, qty: 4, requestedBy: 5, approvedBy: 6, issuedBy: 7,
  status: 8, updatedAt: 9 };

// ---------------------------------------------------------------------------
// 2. Pure logic
// ---------------------------------------------------------------------------

function isPlainObject_(x) {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isBarId_(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(s);
}

function isDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

function isMonth_(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function isForm_(s) {
  return s === 'report' || s === 'req';
}

function isStatus_(s) {
  return s === 'draft' || s === 'saved';
}

function isFiniteNum_(n) {
  return typeof n === 'number' && isFinite(n);
}

/** Text -> sheet cell. Cells that could be parsed as formulas get a leading apostrophe. */
function escapeText_(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /^[=+\-@'\t\r]/.test(s) ? "'" + s : s;
}

/** Sheet cell -> text. Inverse of escapeText_. */
function unescapeText_(v) {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return s.charAt(0) === "'" ? s.slice(1) : s;
}

/** Empty/absent -> undefined; number or numeric string -> finite number; otherwise NaN (malformed). */
function parseNum_(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
  return NaN;
}

/** Date cell as YYYY-MM-DD string (Sheets may hand back Date objects for date-looking cells). */
function cellDate_(v) {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v.getTime === 'function' && isFinite(v.getTime())) {
    const p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate());
  }
  return '';
}

function cellIso_(v) {
  if (v && typeof v.toISOString === 'function') return v.toISOString();
  return v === undefined || v === null ? '' : String(v);
}

function itemInfo_(meta, code) {
  const items = meta && isPlainObject_(meta.items) ? meta.items : null;
  const it = items && isPlainObject_(items[code]) ? items[code] : null;
  return {
    name: it && typeof it.name === 'string' ? it.name : '',
    category: it && typeof it.category === 'string' ? it.category : '',
  };
}

/** Rows of one record -> sheet rows (no header). Rows are assumed validated. */
function rowsToSheetValues(form, barId, date, rows, meta, nowIso) {
  const m = meta || {};
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const info = itemInfo_(m, r.itemCode);
    if (form === 'report') {
      out.push([
        barId, date, r.itemCode, escapeText_(info.name), escapeText_(info.category),
        r.sizeOz === undefined ? '' : r.sizeOz,
        r.openBtl, r.openOz, r.dailyStore, r.transferIn, r.transferOut, r.sale,
        r.countedBtl === undefined ? '' : r.countedBtl,
        r.countedOz === undefined ? '' : r.countedOz,
        escapeText_(r.remark),
        r.openFrom === undefined ? '' : r.openFrom,
        m.status, escapeText_(m.reportBy), nowIso,
      ]);
    } else {
      out.push([
        barId, date, r.itemCode, escapeText_(info.name), r.qty,
        escapeText_(m.requestedBy), escapeText_(m.approvedBy), escapeText_(m.issuedBy), m.status, nowIso,
      ]);
    }
  }
  return out;
}

/** Sheet row -> {date, row, meta} or null if malformed. */
function parseReportRow_(v) {
  if (!Array.isArray(v) || v.length < REPORT_HEADERS.length) return null;
  const itemCode = unescapeText_(v[RC.itemCode]);
  const status = String(v[RC.status]);
  if (itemCode === '' || !isStatus_(status)) return null;
  const nums = {};
  const required = ['openBtl', 'openOz', 'dailyStore', 'transferIn', 'transferOut', 'sale'];
  for (let i = 0; i < required.length; i++) {
    const n = parseNum_(v[RC[required[i]]]);
    if (n === undefined || isNaN(n)) return null;
    nums[required[i]] = n;
  }
  const row = {
    itemCode: itemCode, openBtl: nums.openBtl, openOz: nums.openOz, dailyStore: nums.dailyStore,
    transferIn: nums.transferIn, transferOut: nums.transferOut, sale: nums.sale,
    remark: unescapeText_(v[RC.remark]),
  };
  const optional = ['countedBtl', 'countedOz', 'sizeOz'];
  for (let i = 0; i < optional.length; i++) {
    const n = parseNum_(v[RC[optional[i]]]);
    if (n !== undefined && isNaN(n)) return null;
    if (n !== undefined) row[optional[i]] = n;
  }
  if (row.sizeOz !== undefined && row.sizeOz <= 0) delete row.sizeOz;
  const openFrom = cellDate_(v[RC.openFrom]);
  if (openFrom !== '') row.openFrom = openFrom;
  return { row: row, status: status, reportBy: unescapeText_(v[RC.reportBy]), updatedAt: cellIso_(v[RC.updatedAt]) };
}

function parseReqRow_(v) {
  if (!Array.isArray(v) || v.length < REQ_HEADERS.length) return null;
  const itemCode = unescapeText_(v[QC.itemCode]);
  const status = String(v[QC.status]);
  const qty = parseNum_(v[QC.qty]);
  if (itemCode === '' || !isStatus_(status) || qty === undefined || isNaN(qty)) return null;
  return {
    row: { itemCode: itemCode, qty: qty }, status: status,
    requestedBy: unescapeText_(v[QC.requestedBy]), approvedBy: unescapeText_(v[QC.approvedBy]),
    issuedBy: unescapeText_(v[QC.issuedBy]), updatedAt: cellIso_(v[QC.updatedAt]),
  };
}

/**
 * Sheet rows (no header) -> records of one bar and month, grouped by date (ascending),
 * rows in sheet order. Malformed rows are skipped. updatedAt = latest row updatedAt of the record.
 */
function sheetValuesToRecords(form, values, barId, month) {
  const byDate = {};
  const dates = [];
  for (let i = 0; i < (values || []).length; i++) {
    const v = values[i];
    if (!Array.isArray(v) || v.length === 0) continue;
    if (String(v[0]) !== barId) continue;
    const date = cellDate_(v[1]);
    if (!isDate_(date) || date.slice(0, 7) !== month) continue;
    const p = form === 'report' ? parseReportRow_(v) : parseReqRow_(v);
    if (!p) continue;
    let rec = byDate[date];
    if (!rec) {
      rec = form === 'report'
        ? { barId: barId, date: date, reportBy: p.reportBy, status: p.status, updatedAt: p.updatedAt, rows: [] }
        : { barId: barId, date: date, requestedBy: p.requestedBy, approvedBy: p.approvedBy, issuedBy: p.issuedBy,
            status: p.status, updatedAt: p.updatedAt, rows: [] };
      byDate[date] = rec;
      dates.push(date);
    }
    if (p.updatedAt > rec.updatedAt) rec.updatedAt = p.updatedAt;
    rec.rows.push(p.row);
  }
  dates.sort();
  return dates.map(function (d) { return byDate[d]; });
}

function cleanText_(v) {
  return typeof v === 'string' ? v.slice(0, MAX_TEXT) : '';
}

/** Validate and normalise push rows. Returns array or null if invalid. */
function validateRows_(form, rows) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) return null;
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!isPlainObject_(r)) return null;
    if (typeof r.itemCode !== 'string' || r.itemCode === '' || r.itemCode.length > 64) return null;
    if (form === 'req') {
      if (!isFiniteNum_(r.qty)) return null;
      out.push({ itemCode: r.itemCode, qty: r.qty });
      continue;
    }
    const nr = { itemCode: r.itemCode };
    const req = ['openBtl', 'openOz', 'dailyStore', 'transferIn', 'transferOut', 'sale'];
    for (let k = 0; k < req.length; k++) {
      if (!isFiniteNum_(r[req[k]])) return null;
      nr[req[k]] = r[req[k]];
    }
    const opt = ['countedBtl', 'countedOz', 'sizeOz'];
    for (let k = 0; k < opt.length; k++) {
      const x = r[opt[k]];
      if (x === undefined || x === null) continue;
      if (!isFiniteNum_(x)) return null;
      nr[opt[k]] = x;
    }
    if (nr.sizeOz !== undefined && nr.sizeOz <= 0) delete nr.sizeOz;
    if (r.remark !== undefined && typeof r.remark !== 'string') return null;
    nr.remark = cleanText_(r.remark);
    if (r.openFrom !== undefined && r.openFrom !== null) {
      if (!isDate_(r.openFrom)) return null;
      nr.openFrom = r.openFrom;
    }
    out.push(nr);
  }
  return out;
}

function cleanMeta_(form, meta) {
  const m = isPlainObject_(meta) ? meta : {};
  const items = {};
  if (isPlainObject_(m.items)) {
    const codes = Object.keys(m.items);
    for (let i = 0; i < codes.length && i < MAX_ROWS; i++) {
      const it = m.items[codes[i]];
      if (isPlainObject_(it)) items[codes[i]] = { name: cleanText_(it.name), category: cleanText_(it.category) };
    }
  }
  const status = isStatus_(m.status) ? m.status : null;
  if (form === 'report') return { reportBy: cleanText_(m.reportBy), status: status, items: items };
  return { requestedBy: cleanText_(m.requestedBy), approvedBy: cleanText_(m.approvedBy),
    issuedBy: cleanText_(m.issuedBy), status: status, items: items };
}

function keyMatches_(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || given.length === 0) return false;
  let diff = given.length === expected.length ? 0 : 1;
  const n = Math.max(given.length, expected.length);
  for (let i = 0; i < n; i++) diff |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  return diff === 0;
}

const ERR_ = function (e) { return { ok: false, error: e }; };

/**
 * store = { keyFor(barId): string|null; now(): ISO string;
 *           upsertRecord(form, barId, date, rows, meta, nowIso): void;
 *           loadMonth(form, barId, month): record[]; items(): item[]; lock(fn): T }
 */
function handleRequest(bodyString, store) {
  try {
    if (typeof bodyString !== 'string' || bodyString.length > MAX_BODY_CHARS) return ERR_('bad_request');
    let body;
    try { body = JSON.parse(bodyString); } catch (e) { return ERR_('bad_request'); }
    if (!isPlainObject_(body)) return ERR_('bad_request');
    const action = body.action;
    if (action !== 'push' && action !== 'load' && action !== 'items') return ERR_('bad_request');
    if (!isBarId_(body.barId)) return ERR_('bad_request');

    // Auth before any store read/write (other than the key lookup itself).
    const expected = store.keyFor(body.barId);
    if (!keyMatches_(body.key, expected)) return ERR_('unauthorized');
    const barId = body.barId;

    if (action === 'items') {
      const all = store.items() || [];
      const items = [];
      for (let i = 0; i < all.length; i++) {
        const it = all[i];
        if (!it || it.active === false) continue;
        items.push({ code: it.code, name: it.name, category: it.category, form: it.form, sizeOz: it.sizeOz, active: true });
      }
      return { ok: true, items: items };
    }

    if (action === 'load') {
      if (!isMonth_(body.month)) return ERR_('bad_request');
      // Defensive re-filter: never return another bar's or month's records, even if the store does.
      const keep = function (rec) {
        return rec && rec.barId === barId && isDate_(rec.date) && rec.date.slice(0, 7) === body.month;
      };
      const reports = (store.loadMonth('report', barId, body.month) || []).filter(keep);
      const reqs = (store.loadMonth('req', barId, body.month) || []).filter(keep);
      return { ok: true, reports: reports, reqs: reqs };
    }

    // push
    if (!isForm_(body.form) || !isDate_(body.date)) return ERR_('bad_request');
    const rows = validateRows_(body.form, body.rows);
    if (!rows) return ERR_('bad_request');
    const meta = cleanMeta_(body.form, body.meta);
    if (rows.length > 0 && meta.status === null) return ERR_('bad_request');
    const nowIso = store.now();
    store.lock(function () {
      store.upsertRecord(body.form, barId, body.date, rows, meta, nowIso);
    });
    return { ok: true, applied: rows.length, serverUpdatedAt: nowIso };
  } catch (e) {
    // Never leak error text/stack to the client.
    return ERR_('server_error');
  }
}

// ---------------------------------------------------------------------------
// 3. Thin Google wrappers. NOT unit-tested; verified manually by the owner
//    (run setup(), deploy as Web App, then exercise it from the app's Settings page).
// ---------------------------------------------------------------------------

function doPost(e) {
  let out;
  try {
    const body = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    out = handleRequest(body, makeSheetStore());
  } catch (err) {
    out = { ok: false, error: 'server_error' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function makeSheetStore() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tab = function (form) { return ss.getSheetByName(form === 'report' ? 'Reports' : 'Requisitions'); };
  const width = function (form) { return form === 'report' ? REPORT_HEADERS.length : REQ_HEADERS.length; };
  const readAll = function (form) {
    const sh = tab(form);
    const n = sh.getLastRow() - 1;
    return n > 0 ? sh.getRange(2, 1, n, width(form)).getValues() : [];
  };
  return {
    now: function () { return new Date().toISOString(); },
    keyFor: function (barId) {
      const sh = ss.getSheetByName('Keys');
      const n = sh.getLastRow() - 1;
      const vals = n > 0 ? sh.getRange(2, 1, n, 2).getValues() : [];
      for (let i = 0; i < vals.length; i++) if (String(vals[i][0]) === barId) return String(vals[i][1]);
      return null;
    },
    lock: function (fn) {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { return fn(); } finally { lock.releaseLock(); }
    },
    upsertRecord: function (form, barId, date, rows, meta, nowIso) {
      // Called inside lock(). Delete every row of (bar,date), then append the new rows.
      const sh = tab(form);
      const w = width(form);
      const last = sh.getLastRow();
      if (last > 1) {
        const vals = sh.getRange(2, 1, last - 1, 2).getValues();
        for (let i = vals.length - 1; i >= 0; i--) {
          if (String(vals[i][0]) === barId && cellDate_(vals[i][1]) === date) sh.deleteRow(i + 2);
        }
      }
      if (rows.length === 0) return;
      const out = rowsToSheetValues(form, barId, date, rows, meta, nowIso);
      const start = sh.getLastRow() + 1;
      // Text columns are formatted as plain text BEFORE writing so ids/dates are never auto-converted
      // or parsed as formulas; numeric columns are left alone so numbers stay numbers.
      const textCols = form === 'report' ? [1, 2, 3, 4, 5, 15, 16, 17, 18, 19] : [1, 2, 3, 4, 6, 7, 8, 9, 10];
      for (let i = 0; i < textCols.length; i++) sh.getRange(start, textCols[i], out.length, 1).setNumberFormat('@');
      sh.getRange(start, 1, out.length, w).setValues(out);
    },
    loadMonth: function (form, barId, month) {
      return sheetValuesToRecords(form, readAll(form), barId, month);
    },
    items: function () {
      const sh = ss.getSheetByName('Items');
      const n = sh.getLastRow() - 1;
      const vals = n > 0 ? sh.getRange(2, 1, n, ITEM_HEADERS.length).getValues() : [];
      const out = [];
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (!v[0]) continue;
        const size = parseNum_(v[4]);
        out.push({
          code: String(v[0]), name: String(v[1]), category: String(v[2]), form: String(v[3]),
          sizeOz: size !== undefined && !isNaN(size) && size > 0 ? size : undefined,
          active: !(v[5] === false || String(v[5]).toLowerCase() === 'false'),
        });
      }
      return out;
    },
  };
}

/**
 * Run once from the Apps Script editor (bound to the target spreadsheet).
 * Creates the tabs, seeds Items, creates one key per bar (existing keys are never overwritten).
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ensure = function (name, headers) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (headers && sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    return sh;
  };
  ensure('Reports', REPORT_HEADERS);
  ensure('Requisitions', REQ_HEADERS);
  const items = ensure('Items', ITEM_HEADERS);
  const summary = ensure('Summary', null);
  const keys = ensure('Keys', KEY_HEADERS);

  if (items.getLastRow() <= 1 && ITEMS_SEED.length > 0) {
    const vals = ITEMS_SEED.map(function (it) {
      return [it.code, it.name, it.category, it.form, it.sizeOz === undefined ? '' : it.sizeOz, it.active === false ? false : true];
    });
    items.getRange(2, 1, vals.length, ITEM_HEADERS.length).setNumberFormat('@').setValues(vals);
  }

  const existing = {};
  const n = keys.getLastRow() - 1;
  if (n > 0) {
    const kv = keys.getRange(2, 1, n, 2).getValues();
    for (let i = 0; i < kv.length; i++) if (kv[i][0] && kv[i][1]) existing[String(kv[i][0])] = String(kv[i][1]);
  }
  const added = [];
  for (let i = 0; i < BAR_IDS.length; i++) {
    if (existing[BAR_IDS[i]]) continue;
    const key = Utilities.getUuid() + Utilities.getUuid();
    existing[BAR_IDS[i]] = key;
    added.push([BAR_IDS[i], key]);
  }
  if (added.length > 0) {
    keys.getRange(keys.getLastRow() + 1, 1, added.length, 2).setNumberFormat('@').setValues(added);
  }
  PropertiesService.getScriptProperties().setProperty('BARCHECK_KEYS', JSON.stringify(existing));

  // Summary: ONE simple formula block (sale oz per bar, all time).
  // UNVERIFIED IN GOOGLE; owner to check it renders and adjust if needed.
  summary.getRange('A1').setFormula(
    '=QUERY(Reports!A2:S, "select A, sum(L) where A is not null group by A label A \'Bar\', sum(L) \'Sale oz\'", 0)'
  );
}
