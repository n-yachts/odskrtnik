// Volání Google Drive API v3, Sheets API v4 a Google Pickeru.
// Oprávnění je jen drive.file: aplikace vidí jen tabulky, které sama založila,
// nebo které jí uživatel ukázal v okně Google Disku (Picker).
import { getStoredToken, clearToken } from './auth.js?v=20261110-1119';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
export const APP_PROP = 'odskrtnik';         // značka v appProperties souboru
export const TITLE_PREFIX = 'Odškrtník – ';
export const ITEMS_SHEET = 'Položky';
export const RUN_SHEET = 'Stav';
export const HISTORY_SHEET = 'Historie';
export const ITEM_COLUMNS = ['id', 'kategorie', 'položka', 'poznámka', 'typy', 'hotovo', 'odškrtl', 'kdy'];
export const RUN_COLUMNS = ['typy', 'začato', 'začal', 'název'];
export const HISTORY_COLUMNS = ['začato', 'dokončeno', 'typy', 'hotovo', 'celkem', 'kdo', 'název'];

export class AuthError extends Error {}
export class NoAccessError extends Error {}   // soubor existuje, ale aplikace k němu nemá přístup

async function call(url, { method = 'GET', body, query } = {}) {
  const token = getStoredToken();
  if (!token) throw new AuthError('Přihlášení vypršelo.');
  const u = new URL(url);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(u, {
      method,
      cache: 'no-store',   // vždy čerstvá data, nikdy z mezipaměti prohlížeče
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error('Bez připojení k internetu.');
    e.offline = true;
    throw e;
  }
  if (res.status === 401) { clearToken(); throw new AuthError('Přihlášení vypršelo.'); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    const reasons = [
      ...(data?.error?.errors || []).map(e => e.reason),
      ...(data?.error?.details || []).map(d => d.reason),
    ].filter(Boolean);
    // API není v Google Cloud povolené – nastavení, ne chybějící přístup k seznamu.
    if (reasons.includes('SERVICE_DISABLED') || reasons.includes('accessNotConfigured') || /has not been used in project|is disabled/i.test(msg)) {
      const api = /sheets/i.test(msg) ? 'Google Sheets API' : /picker/i.test(msg) ? 'Google Picker API' : 'Google Drive API';
      const project = (msg.match(/project (\d+)/) || [])[1];
      const err = new Error(`V Google Cloud není povolené ${api}${project ? ` (projekt ${project})` : ''}. Povolte ho a za pár minut to zkuste znovu – viz Nápověda, krok 2.`);
      err.status = res.status; err.setup = true;
      throw err;
    }
    // Překročené limity – zkusit později, nic se nemaže.
    if (res.status === 429 || reasons.some(r => /rateLimit|quota/i.test(r))) {
      const err = new Error('Google teď hlásí příliš mnoho požadavků. Zkuste to za chvíli.');
      err.status = res.status; err.offline = true;   // chovat se jako výpadek: změny počkají
      throw err;
    }
    if (res.status === 404 || res.status === 403) throw new NoAccessError(msg);
    const err = new Error(`Google: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const q = name => `'${name.replace(/'/g, "''")}'`;   // název listu v A1 zápisu

// ---------- Seznamy (soubory) ----------

const FOLDER_NAME = 'Odškrtník';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
let folderId = null;   // složka „Odškrtník“ v Můj disk (hledá se jednou za běh aplikace)

/** Najde (případně založí) složku Odškrtník. Hledá se podle značky, takže přejmenování nevadí. */
export async function appFolder() {
  if (folderId) return folderId;
  const res = await call(`${DRIVE}/files`, {
    query: {
      q: `appProperties has { key='${APP_PROP}' and value='folder' } and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: 'files(id)', pageSize: 10,
    },
  });
  folderId = res.files?.[0]?.id || (await call(`${DRIVE}/files`, {
    method: 'POST', query: { fields: 'id' },
    body: { name: FOLDER_NAME, mimeType: FOLDER_MIME, appProperties: { [APP_PROP]: 'folder' } },
  })).id;
  return folderId;
}

export async function listLists() {
  const res = await call(`${DRIVE}/files`, {
    query: {
      q: `appProperties has { key='${APP_PROP}' and value='1' } and trashed=false`,
      fields: 'files(id,name,ownedByMe,shared,modifiedTime,owners(displayName,emailAddress),parents,appProperties)',
      orderBy: 'name', pageSize: 200,
    },
  });
  const files = res.files || [];
  moveOldLists(files).catch(e => console.warn('Přesun do složky Odškrtník:', e));
  return files.map(fileToList);
}

let moveTried = false;
/** Vlastní seznamy z dřívějších verzí (založené v kořeni Disku) jednou přesune do složky Odškrtník.
 *  Přesunuté se označí (appProperties.odskrtnikFolder), takže seznam, který si uživatel
 *  později sám přesune jinam, už aplikace nechá být. Cizí (sdílené) seznamy přesouvat nelze. */
async function moveOldLists(files) {
  const todo = files.filter(f => f.ownedByMe !== false && !f.appProperties?.odskrtnikFolder);
  if (moveTried || !todo.length) return;
  moveTried = true;
  const folder = await appFolder();
  for (const f of todo) {
    const from = (f.parents || []).filter(p => p !== folder).join(',');
    await call(`${DRIVE}/files/${encodeURIComponent(f.id)}`, {
      method: 'PATCH',
      query: { addParents: folder, ...(from ? { removeParents: from } : {}), fields: 'id' },
      body: { appProperties: { odskrtnikFolder: '1' } },
    });
  }
}

export async function getList(id) {
  const f = await call(`${DRIVE}/files/${encodeURIComponent(id)}`, {
    query: { fields: 'id,name,ownedByMe,shared,modifiedTime,owners(displayName,emailAddress),appProperties,trashed' },
  });
  return fileToList(f);
}

function fileToList(f) {
  return {
    id: f.id,
    name: f.name.startsWith(TITLE_PREFIX) ? f.name.slice(TITLE_PREFIX.length) : f.name,
    ownedByMe: f.ownedByMe !== false,
    shared: !!f.shared,
    owner: f.owners?.[0]?.displayName || '',
    modified: f.modifiedTime || '',
  };
}

/** Založí novou tabulku (listy Položky, Stav, Historie) a zapíše do ní položky předlohy. */
export async function createList(name, items = [], by = '') {
  let folder = null;
  try { folder = await appFolder(); } catch (e) {
    if (e instanceof AuthError || e.offline || e.setup) throw e;
    console.warn('Složka Odškrtník:', e);   // když se nepovede, seznam vznikne v kořeni Disku
  }
  const file = await call(`${DRIVE}/files`, {
    method: 'POST',
    query: { fields: 'id,name,ownedByMe,shared,modifiedTime,owners(displayName,emailAddress)' },
    body: {
      name: TITLE_PREFIX + name, mimeType: 'application/vnd.google-apps.spreadsheet',
      appProperties: { [APP_PROP]: '1', odskrtnikFolder: '1' },
      ...(folder ? { parents: [folder] } : {}),
    },
  });
  const meta = await call(`${SHEETS}/${file.id}`, { query: { fields: 'sheets.properties(sheetId,title)' } });
  const firstId = meta.sheets[0].properties.sheetId;
  const bold = sheetId => ({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
  await call(`${SHEETS}/${file.id}:batchUpdate`, {
    method: 'POST',
    body: {
      requests: [
        { updateSheetProperties: { properties: { sheetId: firstId, title: ITEMS_SHEET, gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } },
        { addSheet: { properties: { sheetId: 101, title: RUN_SHEET, gridProperties: { frozenRowCount: 1 } } } },
        { addSheet: { properties: { sheetId: 102, title: HISTORY_SHEET, gridProperties: { frozenRowCount: 1 } } } },
        bold(firstId), bold(101), bold(102),
        // Sloupec „hotovo“ jako zaškrtávací políčka – jde odškrtávat i přímo v Tabulkách.
        { setDataValidation: { range: { sheetId: firstId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 }, rule: { condition: { type: 'BOOLEAN' } } } },
        // Sloupec id je technický – úzký a šedý.
        { updateDimensionProperties: { range: { sheetId: firstId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 70 }, fields: 'pixelSize' } },
        { repeatCell: { range: { sheetId: firstId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 } } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } },
        { updateDimensionProperties: { range: { sheetId: firstId, dimension: 'COLUMNS', startIndex: 1, endIndex: 3 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } },
      ],
    },
  });
  await call(`${SHEETS}/${file.id}/values:batchUpdate`, {
    method: 'POST',
    body: {
      valueInputOption: 'RAW',
      data: [
        { range: `${q(ITEMS_SHEET)}!A1`, values: [ITEM_COLUMNS, ...items.map(itemToRow)] },
        { range: `${q(RUN_SHEET)}!A1`, values: [RUN_COLUMNS, runToRow({ types: [], started: '', by, title: '' })] },
        { range: `${q(HISTORY_SHEET)}!A1`, values: [HISTORY_COLUMNS] },
      ],
    },
  });
  return fileToList(file);
}

export async function renameList(id, name) {
  await call(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name: TITLE_PREFIX + name } });
}

/** Vlastník seznam smaže (do koše Disku); ostatní se musí jen odebrat ze svého přehledu. */
export async function trashList(id) {
  await call(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: 'PATCH', body: { trashed: true } });
}

// ---------- Sdílení ----------

export async function listPeople(id) {
  const res = await call(`${DRIVE}/files/${encodeURIComponent(id)}/permissions`, {
    query: { fields: 'permissions(id,type,role,emailAddress,displayName)' },
  });
  return (res.permissions || []).filter(p => p.type === 'user');
}

export async function shareList(id, email, appUrl, listName) {
  const message = `Sdílím s tebou seznam „${listName}“. Otevři ho v aplikaci Odškrtník: ${appUrl}`;
  await call(`${DRIVE}/files/${encodeURIComponent(id)}/permissions`, {
    method: 'POST',
    query: { sendNotificationEmail: 'true', emailMessage: message },
    body: { type: 'user', role: 'writer', emailAddress: email },
  });
}

export async function unshare(id, permissionId) {
  await call(`${DRIVE}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE' });
}

export async function whoAmI() {
  const res = await call(`${DRIVE}/about`, { query: { fields: 'user(displayName,emailAddress)' } });
  return res.user || {};
}

// ---------- Obsah seznamu ----------
// Položky se hledají vždy podle id (sloupec A) těsně před zápisem – ostatní mohli mezitím
// přidat nebo smazat řádky, nebo tabulku upravit ručně v Google Tabulkách.

const isTrue = v => v === true || String(v).trim().toUpperCase() === 'TRUE';
const splitTypes = v => String(v ?? '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
const rowToItem = r => ({
  id: String(r[0] ?? ''), cat: String(r[1] ?? '').trim(), name: String(r[2] ?? '').trim(), note: String(r[3] ?? ''),
  types: splitTypes(r[4]), done: isTrue(r[5]), by: String(r[6] ?? ''), at: String(r[7] ?? ''),
});
export const itemToRow = i => [i.id, i.cat || '', i.name, i.note || '', (i.types || []).join(', '), !!i.done, i.done ? i.by || '' : '', i.done ? i.at || '' : ''];
const runToRow = r => [(r.types || []).join(', '), r.started || '', r.by || '', r.title || ''];
const rowToRun = r => ({ types: splitTypes(r?.[0]), started: String(r?.[1] ?? ''), by: String(r?.[2] ?? ''), title: String(r?.[3] ?? '') });
const rowToHistory = r => ({ started: String(r[0] ?? ''), finished: String(r[1] ?? ''), types: splitTypes(r[2]), done: Number(r[3]) || 0, total: Number(r[4]) || 0, by: String(r[5] ?? ''), title: String(r[6] ?? '') });
const newRowId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/**
 * Načte položky a stav průchodu. Řádky dopsané ručně v Tabulkách (bez id nebo bez kategorie)
 * doplní: id vygeneruje, prázdná kategorie = kategorie řádku nad ním.
 */
export async function readList(id) {
  const res = await call(`${SHEETS}/${encodeURIComponent(id)}/values:batchGet`, {
    query: { ranges: `${q(ITEMS_SHEET)}!A2:H`, valueRenderOption: 'UNFORMATTED_VALUE' },
  });
  const rows = res.valueRanges?.[0]?.values || [];
  const items = [], fixes = [];
  let lastCat = '';
  rows.forEach((r, idx) => {
    const it = rowToItem(r);
    if (!it.name) return;
    let fix = false;
    if (!it.id) { it.id = newRowId(); fix = true; }
    if (!it.cat) { it.cat = lastCat || 'Ostatní'; fix = true; }
    lastCat = it.cat;
    if (fix) fixes.push({ range: `${q(ITEMS_SHEET)}!A${idx + 2}:B${idx + 2}`, values: [[it.id, it.cat]] });
    items.push(it);
  });
  if (fixes.length) {
    await call(`${SHEETS}/${encodeURIComponent(id)}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data: fixes } });
  }
  // Stav čteme zvlášť, aby ručně upravené tabulky bez listu Stav nespadly.
  let run = rowToRun([]);
  try {
    const s = await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(RUN_SHEET)}!A2:D2`)}`);
    run = rowToRun(s.values?.[0]);
  } catch (e) { if (e instanceof AuthError || e.offline) throw e; }
  return { items, run };
}

export async function readHistory(id) {
  const h = await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(HISTORY_SHEET)}!A2:G`)}`, {
    query: { valueRenderOption: 'UNFORMATTED_VALUE' },
  });
  return (h.values || []).filter(r => r[0] || r[1]).map(rowToHistory);
}

async function readIds(id) {
  const res = await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(ITEMS_SHEET)}!A2:A`)}`);
  return (res.values || []).map(r => String(r[0] ?? ''));
}

async function rowOf(id, itemId) {
  const idx = (await readIds(id)).indexOf(itemId);
  return idx < 0 ? 0 : idx + 2;
}

async function sheetIdOf(id, title) {
  const meta = await call(`${SHEETS}/${encodeURIComponent(id)}`, { query: { fields: 'sheets.properties(sheetId,title)' } });
  const s = meta.sheets.find(x => x.properties.title === title);
  if (!s) throw new Error(`V tabulce chybí list „${title}“.`);
  return s.properties.sheetId;
}

const put = (id, range, values) => call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`, {
  method: 'PUT', query: { valueInputOption: 'RAW' }, body: { values },
});

/** Přidá položku za poslední řádek její kategorie (nová kategorie → na konec). */
export async function appendItem(id, item) {
  const res = await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(ITEMS_SHEET)}!A2:B`)}`);
  const rows = res.values || [];
  let last = -1;
  rows.forEach((r, i) => { if (String(r[1] ?? '').trim() === item.cat) last = i; });
  if (last >= 0 && last < rows.length - 1) {
    const sheetId = await sheetIdOf(id, ITEMS_SHEET);
    await call(`${SHEETS}/${encodeURIComponent(id)}:batchUpdate`, {
      method: 'POST',
      body: { requests: [{ insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: last + 2, endIndex: last + 3 }, inheritFromBefore: true } }] },
    });
    await put(id, `${q(ITEMS_SHEET)}!A${last + 3}:H${last + 3}`, [itemToRow(item)]);
    return;
  }
  await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(ITEMS_SHEET)}!A:H`)}:append`, {
    method: 'POST',
    query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
    body: { values: [itemToRow(item)] },
  });
}

/** Zapíše kategorii, název, poznámku a typy (sloupce B–E); zatržítko nechá být. */
export async function updateItem(id, item) {
  const row = await rowOf(id, item.id);
  if (!row) return false;   // položku mezitím někdo smazal
  await put(id, `${q(ITEMS_SHEET)}!B${row}:E${row}`, [itemToRow(item).slice(1, 5)]);
  return true;
}

/** Odškrtne / vrátí položku (sloupce F–H). */
export async function tickItem(id, itemId, done, by, at) {
  const row = await rowOf(id, itemId);
  if (!row) return false;
  await put(id, `${q(ITEMS_SHEET)}!F${row}:H${row}`, [[!!done, done ? by || '' : '', done ? at || '' : '']]);
  return true;
}

/** Prohodí dva řádky (posun položky nahoru/dolů). */
export async function swapItems(id, a, b) {
  const res = await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(ITEMS_SHEET)}!A2:H`)}`, {
    query: { valueRenderOption: 'UNFORMATTED_VALUE' },
  });
  const rows = res.values || [];
  const ia = rows.findIndex(r => String(r[0] ?? '') === a), ib = rows.findIndex(r => String(r[0] ?? '') === b);
  if (ia < 0 || ib < 0) return false;
  const pad = r => [...r, '', '', '', '', '', '', '', ''].slice(0, 8);
  await call(`${SHEETS}/${encodeURIComponent(id)}/values:batchUpdate`, {
    method: 'POST',
    body: {
      valueInputOption: 'RAW',
      data: [
        { range: `${q(ITEMS_SHEET)}!A${ia + 2}:H${ia + 2}`, values: [pad(rows[ib])] },
        { range: `${q(ITEMS_SHEET)}!A${ib + 2}:H${ib + 2}`, values: [pad(rows[ia])] },
      ],
    },
  });
  return true;
}

/** Smaže řádky s danými ID (odspodu, aby se indexy neposunuly). */
export async function deleteItems(id, itemIds) {
  const ids = await readIds(id);
  const rows = itemIds.map(x => ids.indexOf(x)).filter(i => i >= 0).sort((a, b) => b - a);
  if (!rows.length) return;
  const sheetId = await sheetIdOf(id, ITEMS_SHEET);
  await call(`${SHEETS}/${encodeURIComponent(id)}:batchUpdate`, {
    method: 'POST',
    body: { requests: rows.map(i => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i + 1, endIndex: i + 2 } } })) },
  });
}

/**
 * Nový průchod: (předchozí zapíše do Historie), uloží typy a čas do listu Stav
 * a vynuluje všechna zatržítka.
 */
export async function resetRun(id, run, hist) {
  if (hist) {
    await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(HISTORY_SHEET)}!A:G`)}:append`, {
      method: 'POST', query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
      body: { values: [[hist.started || '', hist.finished || '', (hist.types || []).join(', '), hist.done, hist.total, hist.by || '', hist.title || '']] },
    });
  }
  await put(id, `${q(RUN_SHEET)}!A2:D2`, [runToRow(run)]);
  const n = (await readIds(id)).length;
  if (n) await put(id, `${q(ITEMS_SHEET)}!F2:H${n + 1}`, Array.from({ length: n }, () => [false, '', '']));
}

// ---------- Google Picker (zpřístupnění sdíleného seznamu) ----------

let pickerReady = null;
function loadPicker() {
  if (pickerReady) return pickerReady;
  pickerReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = () => window.gapi.load('picker', { callback: resolve, onerror: reject });
    s.onerror = () => { pickerReady = null; reject(new Error('Nepodařilo se načíst okno Google Disku.')); };
    document.head.appendChild(s);
  });
  return pickerReady;
}

/**
 * Otevře okno Google Disku. Když uživatel vybere tabulku, aplikace k ní získá přístup.
 * fileId: předvybraný soubor (z odkazu); jinak se ukážou tabulky Odškrtníku sdílené s uživatelem.
 * Vrací pole vybraných ID (prázdné při zrušení).
 */
export async function pickLists({ apiKey, appId, fileId }) {
  await loadPicker();
  const token = getStoredToken();
  if (!token) throw new AuthError('Přihlášení vypršelo.');
  const { picker } = window.google;
  return new Promise(resolve => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS).setMode(picker.DocsViewMode.LIST);
    if (fileId && typeof view.setFileIds === 'function') view.setFileIds(fileId);
    else view.setQuery(TITLE_PREFIX.trim().replace(/ –$/, ''));
    const p = new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setLocale('cs')
      .setTitle('Vyberte sdílený seznam Odškrtníku')
      .setCallback(data => {
        if (data.action === picker.Action.PICKED) resolve((data.docs || []).map(d => d.id));
        else if (data.action === picker.Action.CANCEL) resolve([]);
      })
      .build();
    p.setVisible(true);
  });
}
