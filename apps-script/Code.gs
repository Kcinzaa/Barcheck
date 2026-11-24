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
 * Scaling: every request reads only columns A:B to locate rows; very large sheets should be
 * archived yearly (move old Reports/Requisitions rows to another spreadsheet).
 *
 * Text safety: ALL text columns are plain-text formatted ('@') in setup() and on every write, so values
 * such as =1+1, +1, -2, @x, 'x are stored literally. The pure layer never alters text.
 * OWNER MUST VERIFY in Google: a remark of =1+1 and 'x display literally and read back unchanged.
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
const MAX_NUM = 1e7;

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
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

function isMonth_(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && Number(s.slice(0, 4)) >= 2000 && Number(s.slice(0, 4)) <= 2100;
}

function isForm_(s) {
  return s === 'report' || s === 'req';
}

function isStatus_(s) {
  return s === 'draft' || s === 'saved';
}

function isFiniteNum_(n) {
  return typeof n === 'number' && isFinite(n) && Math.abs(n) <= MAX_NUM;
}

/** Text cell -> string. Text is stored and returned verbatim (no escaping; columns are '@' formatted). */
function textCell_(v) {
  return v === undefined || v === null ? '' : String(v);
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
        barId, date, r.itemCode, textCell_(info.name), textCell_(info.category),
        r.sizeOz === undefined ? '' : r.sizeOz,
        r.openBtl, r.openOz, r.dailyStore, r.transferIn, r.transferOut, r.sale,
        r.countedBtl === undefined ? '' : r.countedBtl,
        r.countedOz === undefined ? '' : r.countedOz,
        textCell_(r.remark),
        r.openFrom === undefined ? '' : r.openFrom,
        m.status, textCell_(m.reportBy), nowIso,
      ]);
    } else {
      out.push([
        barId, date, r.itemCode, textCell_(info.name), r.qty,
        textCell_(m.requestedBy), textCell_(m.approvedBy), textCell_(m.issuedBy), m.status, nowIso,
      ]);
    }
  }
  return out;
}

/** Sheet row -> {date, row, meta} or null if malformed. */
function parseReportRow_(v) {
  if (!Array.isArray(v) || v.length < REPORT_HEADERS.length) return null;
  const itemCode = textCell_(v[RC.itemCode]);
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
    remark: textCell_(v[RC.remark]),
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
  return { row: row, status: status, reportBy: textCell_(v[RC.reportBy]), updatedAt: cellIso_(v[RC.updatedAt]) };
}

function parseReqRow_(v) {
  if (!Array.isArray(v) || v.length < REQ_HEADERS.length) return null;
  const itemCode = textCell_(v[QC.itemCode]);
  const status = String(v[QC.status]);
  const qty = parseNum_(v[QC.qty]);
  if (itemCode === '' || !isStatus_(status) || qty === undefined || isNaN(qty)) return null;
  return {
    row: { itemCode: itemCode, qty: qty }, status: status,
    requestedBy: textCell_(v[QC.requestedBy]), approvedBy: textCell_(v[QC.approvedBy]),
    issuedBy: textCell_(v[QC.issuedBy]), updatedAt: cellIso_(v[QC.updatedAt]),
  };
}

/**
 * Sheet rows (no header) -> records of one bar and month, grouped by date (ascending),
 * rows in sheet order. Malformed rows are skipped. updatedAt = latest row updatedAt of the record.
 */
function sheetValuesToRecords(form, values, barId, month) {
  const byDate = {};
  const seenCodes = {};
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
    // Duplicate (date,itemCode) rows can remain after an interrupted push: the LAST row wins.
    const seen = seenCodes[date] || (seenCodes[date] = {});
    if (Object.prototype.hasOwnProperty.call(seen, p.row.itemCode)) rec.rows[seen[p.row.itemCode]] = p.row;
    else { seen[p.row.itemCode] = rec.rows.length; rec.rows.push(p.row); }
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
    // remark: undefined/null are accepted and stored as ''.
    if (r.remark !== undefined && r.remark !== null && typeof r.remark !== 'string') return null;
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

/** First non-blank key for barId from rows of [barId, key]; null if none. */
function pickKey_(keyRows, barId) {
  for (let i = 0; i < (keyRows || []).length; i++) {
    const r = keyRows[i];
    if (!Array.isArray(r) || String(r[0]) !== barId) continue;
    const k = r[1] === undefined || r[1] === null ? '' : String(r[1]).trim();
    if (k !== '') return k;
  }
  return null;
}

/** Sheet row numbers (1-based, data starts at row 2) of rows in [barId,date] pairs accepted by pred(barId,date). */
function matchRowNumbers_(abValues, pred) {
  const out = [];
  for (let i = 0; i < (abValues || []).length; i++) {
    const v = abValues[i];
    if (Array.isArray(v) && pred(String(v[0]), cellDate_(v[1]))) out.push(i + 2);
  }
  return out;
}

/** Ascending row numbers -> contiguous runs [{start,count}]. */
function toRuns_(rowNumbers) {
  const runs = [];
  for (let i = 0; i < rowNumbers.length; i++) {
    const last = runs[runs.length - 1];
    if (last && rowNumbers[i] === last.start + last.count) last.count++;
    else runs.push({ start: rowNumbers[i], count: 1 });
  }
  return runs;
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
    // Timestamp is taken INSIDE the lock so a slow earlier push cannot stamp an older time after a newer one.
    let nowIso = '';
    store.lock(function () {
      nowIso = store.now();
      store.upsertRecord(body.form, barId, body.date, rows, meta, nowIso);
    });
    return { ok: true, applied: rows.length, serverUpdatedAt: nowIso };
  } catch (e) {
    // store.lock throws {code:'busy'} when the lock cannot be acquired in time.
    if (e && e.code === 'busy') return ERR_('busy');
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
  // 1-based text columns per form (everything except the numeric columns).
  const textCols = function (form) {
    return form === 'report' ? [1, 2, 3, 4, 5, 15, 16, 17, 18, 19] : [1, 2, 3, 4, 6, 7, 8, 9, 10];
  };
  // Only columns A:B are read to locate rows.
  const readAB = function (sh) {
    const n = sh.getLastRow() - 1;
    return n > 0 ? sh.getRange(2, 1, n, 2).getValues() : [];
  };
  return {
    now: function () { return new Date().toISOString(); },
    keyFor: function (barId) {
      const sh = ss.getSheetByName('Keys');
      const n = sh.getLastRow() - 1;
      return pickKey_(n > 0 ? sh.getRange(2, 1, n, 2).getValues() : [], barId);
    },
    lock: function (fn) {
      const lock = LockService.getScriptLock();
      try { lock.waitLock(20000); } catch (e) { throw { code: 'busy' }; }
      let threw = false;
      try {
        return fn();
      } catch (e) {
        threw = true;
        throw e;
      } finally {
        try {
          try { SpreadsheetApp.flush(); } catch (f) { if (!threw) throw f; } // never mask the original error
        } finally {
          lock.releaseLock();
        }
      }
    },
    upsertRecord: function (form, barId, date, rows, meta, nowIso) {
      // Called inside lock(). APPEND-FIRST: write new rows, then delete the old ones, so a failure
      // leaves duplicates (deduped on load, last row wins), never loss.
      const sh = tab(form);
      const old = matchRowNumbers_(readAB(sh), function (b, d) { return b === barId && d === date; });
      if (rows.length > 0) {
        const out = rowsToSheetValues(form, barId, date, rows, meta, nowIso);
        const start = sh.getLastRow() + 1;
        const needMax = start + out.length - 1;
        if (sh.getMaxRows() < needMax) sh.insertRowsAfter(sh.getMaxRows(), needMax - sh.getMaxRows());
        // Plain-text format on the exact range BEFORE writing, so =1+1, +1, -2, @x, 'x stay literal.
        const cols = textCols(form);
        for (let i = 0; i < cols.length; i++) sh.getRange(start, cols[i], out.length, 1).setNumberFormat('@');
        sh.getRange(start, 1, out.length, width(form)).setValues(out);
      }
      if (old.length === 0) return;
      // Sheets refuses to delete every non-frozen row: keep at least one spare row below the data.
      if (sh.getMaxRows() <= sh.getLastRow()) sh.insertRowsAfter(sh.getMaxRows(), 1);
      const runs = toRuns_(old);
      for (let i = runs.length - 1; i >= 0; i--) sh.deleteRows(runs[i].start, runs[i].count);
    },
    loadMonth: function (form, barId, month) {
      const sh = tab(form);
      const nums = matchRowNumbers_(readAB(sh), function (b, d) { return b === barId && d.slice(0, 7) === month; });
      const vals = [];
      const runs = toRuns_(nums);
      for (let i = 0; i < runs.length; i++) {
        const got = sh.getRange(runs[i].start, 1, runs[i].count, width(form)).getValues();
        for (let j = 0; j < got.length; j++) vals.push(got[j]);
      }
      return sheetValuesToRecords(form, vals, barId, month);
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
  const reports = ensure('Reports', REPORT_HEADERS);
  const reqs = ensure('Requisitions', REQ_HEADERS);
  const items = ensure('Items', ITEM_HEADERS);
  const summary = ensure('Summary', null);
  const keys = ensure('Keys', KEY_HEADERS);

  // Plain-text format on WHOLE text columns (OWNER MUST VERIFY in Google that =1+1 and 'x display literally).
  const textFormat = function (sh, cols) {
    const rowsN = Math.max(sh.getMaxRows() - 1, 1);
    for (let i = 0; i < cols.length; i++) sh.getRange(2, cols[i], rowsN, 1).setNumberFormat('@');
  };
  textFormat(reports, [1, 2, 3, 4, 5, 15, 16, 17, 18, 19]);
  textFormat(reqs, [1, 2, 3, 4, 6, 7, 8, 9, 10]);
  textFormat(items, [1, 2, 3, 4]);
  textFormat(keys, [1, 2]);

  if (items.getLastRow() <= 1 && ITEMS_SEED.length > 0) {
    const vals = ITEMS_SEED.map(function (it) {
      return [it.code, it.name, it.category, it.form, it.sizeOz === undefined ? '' : it.sizeOz, it.active === false ? false : true];
    });
    items.getRange(2, 1, vals.length, ITEM_HEADERS.length).setValues(vals); // text cols already '@' above
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
  summary.getRange('A1').setNote('Unverified in Google; owner to check this formula.');
  summary.getRange('A1').setFormula(
    '=QUERY(Reports!A2:S, "select A, sum(L) where A is not null group by A label A \'Bar\', sum(L) \'Sale oz\'", 0)'
  );
}
