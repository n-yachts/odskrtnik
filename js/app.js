import { initAuth, signIn, signOut, getStoredToken, SCOPES } from './auth.js?v=20261110-1119';
import * as G from './google.js?v=20261110-1119';
import { ListStore, newId, nowIso, forgetList } from './store.js?v=20261110-1119';
import { TEMPLATES, templateItems, parseTypes, formatTypes, sameType, allTypes, inRun, groupByCategory, progress, neighbour, plural } from './model.js?v=20261110-1119';

// ---------- Úložiště v prohlížeči ----------
const LS = {
  client: 'odskrtnik.clientId', key: 'odskrtnik.apiKey', step: 'odskrtnik.setupStep',
  last: 'odskrtnik.lastList', lists: 'odskrtnik.lists', hidden: 'odskrtnik.hidden', me: 'odskrtnik.me',
  hideDone: 'odskrtnik.hideDone',
};
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
  json: (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
  setJson: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const PUBLIC_URL = 'https://n-yachts.github.io/odskrtnik/';
const CONSOLE = 'https://console.cloud.google.com';
const POLL_MS = 15000;

const state = {
  lists: store.json(LS.lists, []),
  hidden: store.json(LS.hidden, []),
  me: store.json(LS.me, {}),
  list: null,          // aktuální seznam {id, name, …}
  data: null,          // ListStore
  editing: null,
  editMode: false,     // úpravy položek místo odškrtávání
  closed: new Set(),   // ručně sbalené kategorie
  opened: new Set(),   // ručně rozbalené hotové kategorie (při „skrýt hotové“)
  pendingOpen: null,   // ID seznamu z odkazu, ke kterému chybí přístup
};

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = n => String(n || '').split(/\s+/)[0];

// ---------- Pohledy ----------
const VIEWS = ['file', 'setup', 'signin', 'lists', 'grant', 'list'];
function show(view) {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  $('#btn-settings').hidden = view === 'setup' || view === 'file';
  document.body.dataset.view = view;
}
const current = () => VIEWS.find(v => !$(`#view-${v}`).hidden);
function busy(on) { $('#loading').hidden = !on; }

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast ${kind}`;
  try { t.hidePopover(); t.showPopover(); } catch { t.hidden = false; }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { try { t.hidePopover(); } catch { t.hidden = true; } }, kind === 'error' ? 7000 : 2500);
}

// ---------- Průvodce prvním spuštěním ----------
const SETUP = [
  {
    title: 'Vítejte',
    html: () => `
      <h1>Vítejte v Odškrtníku</h1>
      <a class="help-card" href="help.html" target="_blank" rel="noopener">
        <span class="hc-icon">📖</span>
        <span><b>Podrobná nápověda s obrázky</b><br>
        <span class="muted">Jak aplikaci nastavit a používat, krok za krokem. Otevře se v nové záložce.</span></span>
      </a>
      <ul class="features">
        <li>⛵ <b>Kontrolní seznamy</b> – před vyplutím, zazimování lodi… pokaždé začnete od nuly</li>
        <li>🧳 <b>Balení na cesty</b> – jeden seznam, typy výletu (hory, moře, služební cesta) vyberete při startu</li>
        <li>📊 Seznam je <b>Google Tabulka</b> – kategorie a položky můžete upravovat i přímo v ní</li>
        <li>👥 <b>Sdílení</b> s posádkou nebo rodinou – každý svým Google účtem</li>
        <li>📶 Funguje i <b>bez signálu</b> – změny se odešlou po připojení</li>
      </ul>
      <p>Seznamy se ukládají do <b>Google Tabulek</b> ve složce Odškrtník ve vašem Disku. Aplikace vidí jen tabulky,
         které sama založila nebo které jí ukážete.</p>
      <p><button type="button" class="ghost small" data-goto="4">Už mám Client ID i API klíč, přeskočit →</button></p>`,
  },
  {
    title: 'Projekt',
    html: () => `
      <h2>1. Projekt v Google Cloud</h2>
      <p>Máte už projekt v Google Cloud (třeba pro jinou aplikaci)? Můžete ho použít – v konzoli ho nahoře
         vyberte a pokračujte dalším krokem. Jinak založte nový:</p>
      <ol>
        <li>Otevřete <a href="${CONSOLE}/projectcreate" target="_blank" rel="noopener">vytvoření projektu</a>.</li>
        <li>Název třeba <code>Odskrtnik</code> → <b>Vytvořit</b> a projekt nahoře vyberte.</li>
      </ol>`,
  },
  {
    title: 'API',
    html: () => `
      <h2>2. Povolte tři API</h2>
      <p>U každého odkazu klikněte na <b>Povolit</b> (Enable):</p>
      <ol>
        <li><a href="${CONSOLE}/apis/library/drive.googleapis.com" target="_blank" rel="noopener">Google Drive API</a> – zakládání a sdílení seznamů</li>
        <li><a href="${CONSOLE}/apis/library/sheets.googleapis.com" target="_blank" rel="noopener">Google Sheets API</a> – položky a zatržítka v tabulce</li>
        <li><a href="${CONSOLE}/apis/library/picker.googleapis.com" target="_blank" rel="noopener">Google Picker API</a> – otevření seznamu, který vám někdo nasdílel</li>
      </ol>`,
  },
  {
    title: 'Souhlas',
    html: () => `
      <h2>3. Souhlasová obrazovka</h2>
      <p>Pokud ji projekt už má, tento krok přeskočte.</p>
      <ol>
        <li>Otevřete <a href="${CONSOLE}/auth/overview" target="_blank" rel="noopener">Google Auth Platform</a> → <b>Začít</b>.</li>
        <li>Název aplikace <code>Odškrtník</code>, e-mail podpory, cílová skupina <b>Externí</b>, dokončete.</li>
        <li>V <a href="${CONSOLE}/auth/audience" target="_blank" rel="noopener">Audience</a> klikněte na <b>Publikovat aplikaci</b>.</li>
      </ol>
      <div class="callout">Bez publikování Google po 7 dnech zruší přihlášení. Lidé, se kterými budete sdílet,
        se pak přihlásí svým účtem a potvrdí varování „Google tuto aplikaci neověřil“.</div>
      <p class="muted">Volitelně v <a href="${CONSOLE}/auth/scopes" target="_blank" rel="noopener">Data access</a>
         přidejte oprávnění <code>${SCOPES[0]}</code>.</p>`,
  },
  {
    title: 'Client ID',
    html: () => `
      <h2>4. Client ID</h2>
      <p>V
         <a href="${CONSOLE}/auth/clients" target="_blank" rel="noopener">Clients</a> otevřete svého klienta
         (nebo vytvořte nový typu <b>Webová aplikace</b>) a do <b>Authorized JavaScript origins</b> mějte:</p>
      <ul>
        <li><code>https://n-yachts.github.io</code></li>
        <li><code>http://localhost:8082</code> – jen pro spouštění na počítači přes <code>start.cmd</code></li>
      </ul>
      <p class="copyline">Tato stránka běží na <code id="origin-val">${esc(location.origin)}</code>
        <button type="button" class="ghost small" data-copy="#origin-val">Kopírovat</button></p>
      <input id="client-input" class="mono" placeholder="123456789-abc….apps.googleusercontent.com"
             value="${esc(store.get(LS.client) || '')}" spellcheck="false" autocomplete="off">
      <p id="client-err" class="error" hidden></p>`,
    validate: () => {
      const v = $('#client-input').value.trim();
      const ok = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(v);
      $('#client-err').hidden = ok;
      $('#client-err').textContent = 'Tohle nevypadá jako Client ID (123456789-xxxx.apps.googleusercontent.com).';
      if (ok) store.set(LS.client, v);
      return ok;
    },
  },
  {
    title: 'API klíč',
    html: () => `
      <h2>5. API klíč pro okno Google Disku</h2>
      <p>Když vám někdo nasdílí seznam, otevřete ho přes okno Google Disku. To potřebuje API klíč:</p>
      <ol>
        <li>Otevřete <a href="${CONSOLE}/apis/credentials" target="_blank" rel="noopener">Credentials</a> →
            <b>Create credentials</b> → <b>API key</b>.</li>
        <li>U klíče klikněte na <b>Edit API key</b> a omezte ho:
          <ul>
            <li><b>Application restrictions:</b> Websites → přidejte <code>https://n-yachts.github.io/*</code>
                a <code>http://localhost:8082/*</code></li>
            <li><b>API restrictions:</b> Restrict key → zaškrtněte <b>Google Picker API</b></li>
          </ul>
          a uložte.</li>
        <li>Zkopírujte klíč (začíná <code>AIza</code>) a vložte ho sem:</li>
      </ol>
      <input id="key-input" class="mono" placeholder="AIza…" value="${esc(store.get(LS.key) || '')}" spellcheck="false" autocomplete="off">
      <p id="key-err" class="error" hidden></p>
      <p class="hint">Klíč je díky omezení použitelný jen z adresy Odškrtníku a jen pro okno Disku. Ukládá se jen ve vašem prohlížeči.</p>`,
    validate: () => {
      const v = $('#key-input').value.trim();
      const ok = /^AIza[0-9A-Za-z_\-]{30,}$/.test(v);
      $('#key-err').hidden = ok;
      $('#key-err').textContent = 'API klíč začíná „AIza“ a má 39 znaků.';
      if (ok) store.set(LS.key, v);
      return ok;
    },
  },
  {
    title: 'Hotovo',
    html: () => `
      <h2>6. Přihlaste se</h2>
      <p>Hotovo. Při prvním přihlášení:</p>
      <ol>
        <li>Pokud se objeví „Google tuto aplikaci neověřil“, klikněte na <b>Pokračovat</b>
            (případně <b>Rozšířené</b> → <b>Přejít na …</b>).</li>
        <li>Povolte přístup k souborům Disku, které aplikace používá.</li>
      </ol>`,
    nextLabel: 'Přihlásit se přes Google',
  },
];

let setupIdx = 0;
function renderSetup() {
  const step = SETUP[setupIdx];
  $('#setup-steps').innerHTML = SETUP.map((s, i) =>
    `<span class="step ${i < setupIdx ? 'done' : ''} ${i === setupIdx ? 'current' : ''}">${i < setupIdx ? '✓' : i + 1}<em>${s.title}</em></span>`).join('');
  $('#setup-body').innerHTML = step.html();
  $('#setup-back').style.visibility = setupIdx === 0 ? 'hidden' : 'visible';
  $('#setup-next').textContent = step.nextLabel || 'Pokračovat →';
  store.set(LS.step, String(setupIdx));
}
$('#setup-back').onclick = () => { if (setupIdx > 0) { setupIdx--; renderSetup(); } };
$('#setup-next').onclick = async () => {
  const step = SETUP[setupIdx];
  if (step.validate && !step.validate()) return;
  if (setupIdx < SETUP.length - 1) { setupIdx++; renderSetup(); return; }
  await doSignIn();
};
$('#setup-body').addEventListener('click', e => {
  const b = e.target.closest('[data-goto]');
  if (b) { setupIdx = Number(b.dataset.goto); renderSetup(); }
});
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const text = $(btn.dataset.copy).textContent;
  try { await navigator.clipboard.writeText(text); toast('Zkopírováno'); } catch { toast(text); }
});
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]')) e.target.closest('dialog').close();
});

// ---------- Přihlášení ----------
async function ensureAuth() { if (!getStoredToken()) await signIn(); }

async function doSignIn() {
  try {
    await initAuth(store.get(LS.client));
    await signIn();
    store.del(LS.step);
    await afterSignIn();
  } catch (e) {
    busy(false);
    toast(e.message, 'error');
    if (current() !== 'setup') show('signin');
  }
}
$('#btn-signin').onclick = doSignIn;

async function afterSignIn() {
  G.whoAmI().then(u => { state.me = u; store.setJson(LS.me, u); }).catch(() => {});
  const link = new URLSearchParams(location.search).get('seznam');
  if (link) {
    history.replaceState(null, '', location.pathname);
    await openFromLink(link);
    return;
  }
  const last = store.get(LS.last);
  if (last && state.lists.some(l => l.id === last)) { openList(last); refreshLists(); return; }
  show('lists');
  renderLists();
  await refreshLists(true);
}

function handleError(e) {
  if (e instanceof G.AuthError) {
    toast('Přihlášení vypršelo. Klepněte na „Obnovit přihlášení“.');
    renderSync();
    return;
  }
  console.error(e);
  toast(e.message || String(e), 'error');
}

// ---------- Seznamy ----------
function saveLists() { store.setJson(LS.lists, state.lists); }

async function refreshLists(withBusy = false) {
  if (withBusy) busy(true);
  try {
    const found = await G.listLists();
    state.lists = found.filter(l => !state.hidden.includes(l.id));
    saveLists();
  } catch (e) {
    if (!(e.offline)) handleError(e);
  } finally {
    busy(false);
    if (current() === 'lists') renderLists();
  }
}

function renderLists() {
  if (!state.lists.length) {
    $('#lists').innerHTML = `<div class="empty">
      <p><b>Zatím nemáte žádný seznam.</b></p>
      <p class="muted">Založte první – třeba z předlohy „Před vyplutím“ nebo „Balení na cesty“. Pokud vám někdo
        seznam nasdílel, klikněte na „Otevřít sdílený“ nebo na odkaz z e-mailu.</p>
      <button class="primary" data-action="new-list">+ Založit první seznam</button></div>`;
    return;
  }
  $('#lists').innerHTML = state.lists.map(l => {
    const d = new ListStore(l.id);
    const who = l.ownedByMe ? (l.shared ? '👥 sdílený' : '') : `👥 od ${esc(firstName(l.owner) || 'někoho')}`;
    let meta = 'otevřete pro načtení', bar = '', cls = '';
    if (d.known) {
      const run = d.run, p = progress(d.items, run.types);
      const what = [run.title, formatTypes(run.types)].filter(Boolean).map(esc).join(' · ');
      cls = p.complete ? 'complete' : '';
      meta = p.complete ? `✓ vše odškrtnuto (${p.total})` : p.done ? `${p.done} z ${p.total} odškrtnuto` : plural(p.total, 'položka', 'položky', 'položek');
      if (what) meta += ` · ${what}`;
      bar = `<span class="bar"><i style="width:${p.total ? Math.round(100 * p.done / p.total) : 0}%"></i></span>`;
    }
    return `<button class="list-card ${cls}" data-open="${esc(l.id)}">
      <span class="lc-name">${esc(l.name)}</span>
      ${bar}
      <span class="lc-meta">${meta}${who ? ` · ${who}` : ''}${d.pending.length ? ' · ⏳ neodesláno' : ''}</span>
    </button>`;
  }).join('');
}

$('#lists').onclick = e => {
  const b = e.target.closest('[data-open]');
  if (b) openList(b.dataset.open);
};
document.addEventListener('click', e => { if (e.target.closest('[data-action="new-list"]')) openListDialog(null); });
$('#btn-new-list').onclick = () => openListDialog(null);
$('#brand').onclick = e => {
  if (['lists', 'list', 'grant'].includes(current())) { e.preventDefault(); goLists(); }
};
$('#btn-back').onclick = () => goLists();

function goLists() {
  state.list = null; state.data = null; state.editMode = false;
  store.del(LS.last);
  show('lists');
  renderLists();
  refreshLists();
}

// Nový seznam (z předlohy) / přejmenování
let listDlgMode = 'new', template = 'vypluti';
function renderTemplates() {
  $('#templates').innerHTML = TEMPLATES.map(t => `<button type="button" class="tpl ${t.id === template ? 'on' : ''}" data-tpl="${t.id}">
    <b>${t.icon} ${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`).join('');
}
function openListDialog(list) {
  listDlgMode = list ? 'rename' : 'new';
  const f = $('#form-list');
  f.reset();
  $('#list-dlg-title').textContent = list ? 'Přejmenovat seznam' : 'Nový seznam';
  $('#btn-list-save').textContent = list ? 'Uložit' : 'Vytvořit';
  $('#template-wrap').hidden = !!list;
  template = 'vypluti';
  renderTemplates();
  f.name.value = list ? list.name : TEMPLATES[0].name;
  $('#dlg-list').showModal();
  if (list) f.name.focus();
}
$('#templates').onclick = e => {
  const b = e.target.closest('[data-tpl]');
  if (!b) return;
  const f = $('#form-list');
  const prev = TEMPLATES.find(t => t.id === template);
  template = b.dataset.tpl;
  const t = TEMPLATES.find(x => x.id === template);
  // Název předlohy přepíšeme, jen pokud ho uživatel sám nezměnil.
  if (!f.name.value.trim() || f.name.value === prev?.name) f.name.value = t.id === 'prazdny' ? '' : t.name;
  renderTemplates();
  if (t.id === 'prazdny') f.name.focus();
};
$('#form-list').onsubmit = async e => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) return;
  try { await ensureAuth(); } catch (err) { return toast(err.message, 'error'); }
  busy(true);
  try {
    if (listDlgMode === 'new') {
      const items = templateItems(template).map(i => ({ ...i, id: newId(), done: false }));
      const l = await G.createList(name, items, firstName(state.me.displayName));
      state.lists.push(l);
      state.lists.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
      saveLists();
      $('#dlg-list').close();
      openList(l.id, { edit: !items.length });
      toast(items.length ? 'Seznam je připravený – položky si můžete upravit' : 'Seznam je připravený – přidejte položky');
    } else {
      await G.renameList(state.list.id, name);
      state.list.name = name;
      const l = state.lists.find(x => x.id === state.list.id);
      if (l) l.name = name;
      saveLists();
      $('#dlg-list').close();
      renderList();
      toast('Přejmenováno');
    }
  } catch (err) { handleError(err); }
  finally { busy(false); }
};

// Otevření sdíleného seznamu (Google Picker)
async function pickShared(fileId) {
  const apiKey = store.get(LS.key);
  if (!apiKey) { toast('Chybí API klíč. Doplňte ho v průvodci (Nastavení → Znovu spustit průvodce).', 'error'); return []; }
  const appId = (store.get(LS.client) || '').split('-')[0];
  try { await ensureAuth(); } catch (err) { toast(err.message, 'error'); return []; }
  try {
    return await G.pickLists({ apiKey, appId, fileId });
  } catch (err) { handleError(err); return []; }
}

$('#btn-open-shared').onclick = async () => {
  const ids = await pickShared();
  if (!ids.length) return;
  state.hidden = state.hidden.filter(h => !ids.includes(h)); store.setJson(LS.hidden, state.hidden);
  await refreshLists(true);
  const added = state.lists.filter(l => ids.includes(l.id));
  if (!added.length) return toast('Vybraná tabulka není seznam Odškrtníku.', 'error');
  if (added.length === 1) openList(added[0].id);
  else { renderLists(); toast(`Přidáno ${added.length} seznamů`); }
};

async function openFromLink(id) {
  busy(true);
  try {
    const l = await G.getList(id);
    if (!state.lists.some(x => x.id === l.id)) { state.lists.push(l); saveLists(); }
    state.hidden = state.hidden.filter(h => h !== id); store.setJson(LS.hidden, state.hidden);
    busy(false);
    openList(id);
  } catch (e) {
    busy(false);
    if (e instanceof G.NoAccessError) { state.pendingOpen = id; show('grant'); }
    else { handleError(e); show('lists'); renderLists(); }
  }
}
$('#btn-grant').onclick = async () => {
  const id = state.pendingOpen;
  const ids = await pickShared(id);
  if (!ids.length) return;
  state.pendingOpen = null;
  await openFromLink(ids[0]);
};
$('#btn-grant-cancel').onclick = () => { state.pendingOpen = null; goLists(); };

// ---------- Jeden seznam ----------
let pollTimer = null;
function openList(id, { edit = false } = {}) {
  const l = state.lists.find(x => x.id === id);
  if (!l) { goLists(); return; }
  state.list = l;
  state.editMode = edit;
  state.closed = new Set();
  state.opened = new Set();
  state.data = new ListStore(id, { onChange: renderList });
  store.set(LS.last, id);
  show('list');
  renderList();
  syncNow();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (current() === 'list' && document.visibilityState === 'visible' && navigator.onLine && getStoredToken()) syncNow();
  }, POLL_MS);
}

function syncNow() {
  if (!state.data) return;
  if (!getStoredToken()) { renderSync(); return; }
  state.data.sync().catch(e => {
    if (e instanceof G.NoAccessError) {
      toast('K seznamu už nemáte přístup (byl smazán nebo přestal být sdílený).', 'error');
      hideList(state.list.id);
      goLists();
    } else handleError(e);
  });
}

window.addEventListener('online', syncNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });

const asDate = iso => new Date(iso + (/Z|[+-]\d\d:\d\d$/.test(iso) ? '' : 'Z'));
function relTime(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - asDate(iso).getTime()) / 1000);
  if (s < 30) return 'právě teď';
  if (s < 90) return 'před minutou';
  if (s < 3600) return `před ${Math.round(s / 60)} min`;
  return fmtDate(iso);
}
const fmtDate = iso => asDate(iso).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = iso => asDate(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });

function renderSync() {
  const d = state.data;
  if (!d) return;
  const n = d.pending.length;
  let html;
  if (!getStoredToken()) html = `<button class="link" id="btn-reauth">🔑 Obnovit přihlášení</button>${n ? ` · ⏳ ${n} neodesláno` : ''}`;
  else if (d.status === 'offline') html = `📶 Offline${n ? ` · ⏳ ${n} ${n === 1 ? 'změna čeká' : 'změn čeká'}` : ''}`;
  else if (d.status === 'syncing') html = '⟳ Ukládám…';
  else if (d.status === 'error') html = `⚠️ ${esc(d.error)}`;
  else html = `✓ Uloženo${d.syncedAt ? ` · ${relTime(d.syncedAt)}` : ''}`;
  $('#sync').innerHTML = html;
  $('#sync').dataset.status = getStoredToken() ? d.status : 'auth';
}
$('#sync').addEventListener('click', async e => {
  if (!e.target.closest('#btn-reauth')) return;
  try { await signIn(); syncNow(); } catch (err) { toast(err.message, 'error'); }
});

function renderList() {
  const d = state.data, l = state.list;
  if (!d || !l) return;
  $('#list-name').textContent = l.name;
  renderSync();
  const items = d.items, run = d.run, edit = state.editMode;
  const shared = l.shared || !l.ownedByMe;
  const me = firstName(state.me.displayName);
  const hideDone = store.get(LS.hideDone) === '1';
  const p = progress(items, run.types);

  // Panel průchodu: postup, typy, Začít znovu
  $('#run').hidden = edit;
  $('#edit-bar').hidden = !edit;
  if (!edit) {
    const tags = [run.title, ...run.types].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const since = run.started ? `od ${fmtDate(run.started)}${run.by && shared ? ` (${esc(run.by)})` : ''}` : '';
    $('#run').className = `run ${p.complete ? 'complete' : ''}`;
    $('#run').innerHTML = `
      <div class="run-top">
        <span class="run-count">${p.done}<small> / ${p.total}</small></span>
        <span class="bar"><i style="width:${p.total ? Math.round(100 * p.done / p.total) : 0}%"></i></span>
        <button class="ghost small" id="btn-new-run">↺ Začít znovu</button>
      </div>
      <div class="run-meta">
        ${p.complete ? '<span class="run-done">🎉 Vše odškrtnuto</span>' : ''}
        ${tags}<span>${since}</span>
        <span class="spacer"></span>
        <label class="hide-done"><input type="checkbox" id="chk-hide" ${hideDone ? 'checked' : ''}> skrýt hotové</label>
      </div>`;
  }

  if (!items.length) {
    $('#items').innerHTML = `<div class="empty"><p><b>Seznam je prázdný.</b></p>
      <p class="muted">${edit ? 'Přidejte první položku tlačítkem „+ Položka“.' : 'Položky přidáte v menu ⋯ → Upravit položky, nebo přímo v Google Tabulce.'}</p>
      ${edit ? '' : '<button class="primary" id="btn-empty-edit">✏️ Přidat položky</button>'}</div>`;
    return;
  }

  const groups = groupByCategory(edit ? items : items.filter(i => inRun(i, run.types)));
  $('#items').innerHTML = groups.map(g => {
    const done = g.items.filter(i => i.done).length, full = done === g.items.length;
    const closed = !edit && (state.closed.has(g.name) || (full && hideDone && !state.opened.has(g.name)));
    const list = edit ? g.items : g.items.filter(i => !(hideDone && i.done));
    return `<section class="cat-block ${closed ? 'closed' : ''} ${full ? 'full' : ''}">
      <button class="cat" data-cat="${esc(g.name)}"><span class="chev">▾</span> ${esc(g.name)}
        <span class="cnt">${edit ? g.items.length : `${full ? '✓ ' : ''}${done}/${g.items.length}`}</span></button>
      ${list.length ? `<ul class="item-list">${list.map(i => edit ? editRow(i, items, run) : itemRow(i, shared, me)).join('')}</ul>` : ''}
      ${edit ? `<button class="ghost small cat-add" data-add="${esc(g.name)}">+ Přidat do „${esc(g.name)}“</button>` : ''}
    </section>`;
  }).join('');
}

function itemRow(i, shared, me) {
  const by = shared && i.done && i.by && i.by !== me ? `<span class="by">${esc(i.by)}</span>` : '';
  return `<li class="item ${i.done ? 'done' : ''}">
    <button class="tick" data-toggle="${esc(i.id)}" aria-pressed="${i.done}">
      <span class="box"></span>
      <span class="it-body">
        <span class="it-name">${esc(i.name)}</span>${by}
        ${i.note ? `<span class="it-note">${esc(i.note)}</span>` : ''}
      </span>
    </button>
  </li>`;
}

function editRow(i, items, run) {
  const up = neighbour(items, i.id, -1), down = neighbour(items, i.id, 1);
  const types = i.types.length ? `<span class="types">${i.types.map(t => `<span>${esc(t)}</span>`).join('')}</span>` : '';
  return `<li class="item ${inRun(i, run.types) ? '' : 'out'}">
    <button class="edit-body" data-edit="${esc(i.id)}">
      <span class="it-name">${esc(i.name)}</span>${types}
      ${i.note ? `<span class="it-note">${esc(i.note)}</span>` : ''}
    </button>
    <span class="moves">
      <button data-move="${esc(i.id)}" data-dir="-1" ${up ? '' : 'disabled'} aria-label="Posunout nahoru">▲</button>
      <button data-move="${esc(i.id)}" data-dir="1" ${down ? '' : 'disabled'} aria-label="Posunout dolů">▼</button>
    </span>
  </li>`;
}

// Odškrtávání, sbalení kategorií, úpravy
$('#view-list').addEventListener('click', e => {
  const d = state.data;
  const t = e.target.closest('[data-toggle]');
  if (t) {
    const it = d.items.find(i => i.id === t.dataset.toggle);
    if (it) {
      if (navigator.vibrate) navigator.vibrate(15);
      d.tick(it.id, !it.done, firstName(state.me.displayName));
    }
    return;
  }
  const c = e.target.closest('[data-cat]');
  if (c && !state.editMode) {
    const name = c.dataset.cat, closed = c.parentElement.classList.contains('closed');
    if (closed) { state.closed.delete(name); state.opened.add(name); } else { state.closed.add(name); state.opened.delete(name); }
    renderList();
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) { openItem(ed.dataset.edit); return; }
  const add = e.target.closest('[data-add]');
  if (add) { openItem(null, add.dataset.add); return; }
  const mv = e.target.closest('[data-move]');
  if (mv) {
    const other = neighbour(d.items, mv.dataset.move, Number(mv.dataset.dir));
    if (other) d.swap(mv.dataset.move, other.id);
    return;
  }
  if (e.target.closest('#btn-new-run')) { openRunDialog(); return; }
  if (e.target.closest('#btn-empty-edit')) { setEdit(true); return; }
});
$('#view-list').addEventListener('change', e => {
  if (e.target.id === 'chk-hide') { store.set(LS.hideDone, e.target.checked ? '1' : '0'); state.opened.clear(); renderList(); }
});

function setEdit(on) {
  state.editMode = on;
  renderList();
  scrollTo(0, 0);
}
$('#btn-edit-done').onclick = () => setEdit(false);
$('#btn-add-item').onclick = () => {
  const items = state.data.items;
  openItem(null, items.length ? items[items.length - 1].cat : '');
};

// Nový průchod: vynulovat zatržítka, vybrat typy výletu
let runTypes = [];
function openRunDialog() {
  const d = state.data, types = allTypes(d.items);
  runTypes = d.run.types.filter(t => types.some(x => sameType(x, t)));
  const p = progress(d.items, d.run.types);
  $('#form-run').reset();
  $('#run-types-wrap').hidden = !types.length;
  $('#run-intro').textContent = p.done
    ? `Všechna zatržítka se vynulují. Dosavadní průchod (${p.done} z ${p.total}) se uloží do historie.`
    : 'Všechna zatržítka se vynulují.';
  renderRunTypes(types);
  $('#dlg-run').showModal();
}
function renderRunTypes(types = allTypes(state.data.items)) {
  $('#run-types').innerHTML = types.map(t => `<button type="button" class="chip ${runTypes.some(x => sameType(x, t)) ? 'on' : ''}" data-rtype="${esc(t)}">${esc(t)}</button>`).join('');
  const n = progress(state.data.items, runTypes).total;
  $('#run-summary').textContent = `${plural(n, 'položka', 'položky', 'položek')} k odškrtnutí` +
    (types.length && !runTypes.length ? ' (všechny typy)' : '');
}
$('#run-types').onclick = e => {
  const b = e.target.closest('[data-rtype]');
  if (!b) return;
  const t = b.dataset.rtype;
  runTypes = runTypes.some(x => sameType(x, t)) ? runTypes.filter(x => !sameType(x, t)) : [...runTypes, t];
  renderRunTypes();
};
$('#form-run').onsubmit = e => {
  e.preventDefault();
  const d = state.data, old = d.run, p = progress(d.items, old.types);
  const me = firstName(state.me.displayName);
  const hist = p.done ? { started: old.started, finished: nowIso(), types: old.types, done: p.done, total: p.total, by: me, title: old.title } : null;
  d.reset({ types: runTypes, started: nowIso(), by: me, title: e.target.title.value.trim() }, hist);
  state.closed.clear(); state.opened.clear();
  $('#dlg-run').close();
  scrollTo(0, 0);
  toast('Nový průchod – vše od nuly');
};

// Přidání / úprava položky
function openItem(id, cat = '') {
  const d = state.data;
  const it = id ? d.items.find(i => i.id === id) : null;
  if (id && !it) return;
  state.editing = it;
  const f = $('#form-item');
  f.reset();
  $('#item-dlg-title').textContent = it ? 'Upravit položku' : 'Nová položka';
  $('#btn-item-save').textContent = it ? 'Uložit' : 'Přidat';
  $('#btn-item-delete').hidden = !it;
  f.name.value = it?.name || '';
  f.cat.value = it?.cat ?? cat;
  f.types.value = formatTypes(it?.types || []);
  f.note.value = it?.note || '';
  $('#cat-list').innerHTML = groupByCategory(d.items).map(g => `<option value="${esc(g.name)}">`).join('');
  renderItemTypes();
  $('#item-meta').textContent = it?.done && it.by ? `Odškrtl(a) ${it.by}${it.at ? ` · ${relTime(it.at)}` : ''}` : '';
  delete $('#btn-item-delete').dataset.confirm; $('#btn-item-delete').textContent = 'Smazat';
  $('#dlg-item').showModal();
  if (!it) f.name.focus();
}
function renderItemTypes() {
  const cur = parseTypes($('#form-item').types.value);
  const types = allTypes([...state.data.items, { types: cur }]);
  $('#item-types').innerHTML = types.map(t => `<button type="button" class="chip small ${cur.some(x => sameType(x, t)) ? 'on' : ''}" data-itype="${esc(t)}">${esc(t)}</button>`).join('');
}
$('#form-item').types.addEventListener('input', renderItemTypes);
$('#item-types').onclick = e => {
  const b = e.target.closest('[data-itype]');
  if (!b) return;
  const f = $('#form-item'), t = b.dataset.itype, cur = parseTypes(f.types.value);
  f.types.value = formatTypes(cur.some(x => sameType(x, t)) ? cur.filter(x => !sameType(x, t)) : [...cur, t]);
  renderItemTypes();
};
$('#form-item').onsubmit = e => {
  e.preventDefault();
  const f = e.target, it = state.editing, d = state.data;
  const name = f.name.value.trim();
  if (!name) return;
  const data = { name, cat: f.cat.value.trim() || 'Ostatní', types: parseTypes(f.types.value), note: f.note.value.trim() };
  if (it) d.update({ ...it, ...data });
  else {
    d.add({ id: newId(), ...data, done: false, by: '', at: '' });
    toast(`Přidáno: ${name}`);
  }
  $('#dlg-item').close();
};
$('#btn-item-delete').onclick = () => {
  const b = $('#btn-item-delete');
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Opravdu smazat?'; return; }
  state.data.remove([state.editing.id]);
  $('#dlg-item').close();
};

// Historie průchodů
$('#m-history').onclick = async () => {
  $('#dlg-menu').close();
  $('#history').innerHTML = '<li class="muted">Načítám…</li>';
  $('#dlg-history').showModal();
  try {
    await ensureAuth();
    const h = (await G.readHistory(state.list.id)).reverse();
    $('#history').innerHTML = h.map(r => `<li>
      <div class="h-top"><b>${r.finished ? fmtDay(r.finished) : '—'}</b>
        ${r.title ? `<span>${esc(r.title)}</span>` : ''}
        <span class="h-res ${r.done === r.total ? 'full' : ''}">${r.done === r.total ? '✓ ' : ''}${r.done}/${r.total}</span></div>
      <div class="hint">${r.started ? `začato ${fmtDate(r.started)}` : ''}${r.types.length ? ` · ${esc(formatTypes(r.types))}` : ''}${r.by ? ` · ${esc(r.by)}` : ''}</div>
    </li>`).join('') || '<li class="muted">Zatím žádný dokončený průchod. Uloží se při „Začít znovu“.</li>';
  } catch (e) {
    $('#history').innerHTML = `<li class="muted">Historii se nepodařilo načíst${e.offline ? ' (offline)' : `: ${esc(e.message)}`}.</li>`;
  }
};

// Menu seznamu
$('#btn-list-menu').onclick = () => {
  const l = state.list;
  $('#menu-title').textContent = l.name;
  $('#m-edit').textContent = state.editMode ? '☑️ Zpět k odškrtávání' : '✏️ Upravit položky';
  $('#m-delete').textContent = l.ownedByMe ? '🗑️ Smazat seznam' : '🙈 Odebrat z mých seznamů';
  delete $('#m-delete').dataset.confirm;
  $('#dlg-menu').showModal();
};
$('#m-edit').onclick = () => { $('#dlg-menu').close(); setEdit(!state.editMode); };
$('#m-rename').onclick = () => { $('#dlg-menu').close(); openListDialog(state.list); };
$('#m-sheet').onclick = () => window.open(`https://docs.google.com/spreadsheets/d/${state.list.id}/edit`, '_blank', 'noopener');
$('#m-delete').onclick = async () => {
  const b = $('#m-delete'), l = state.list;
  if (b.dataset.confirm !== '1') {
    b.dataset.confirm = '1';
    b.textContent = l.ownedByMe ? 'Opravdu smazat? (i pro ty, se kterými sdílíte)' : 'Opravdu odebrat?';
    return;
  }
  if (l.ownedByMe) {
    try { await ensureAuth(); } catch (err) { return toast(err.message, 'error'); }
    busy(true);
    try { await G.trashList(l.id); } catch (err) { busy(false); return handleError(err); }
    busy(false);
    toast('Seznam je v koši Google Disku');
  } else toast('Seznam odebrán z vašeho přehledu');
  $('#dlg-menu').close();
  hideList(l.id);
  goLists();
};
function hideList(id) {
  state.lists = state.lists.filter(x => x.id !== id); saveLists();
  if (!state.hidden.includes(id)) { state.hidden.push(id); store.setJson(LS.hidden, state.hidden); }
  forgetList(id);
}

// Sdílení
function shareLink(id) { return `${location.origin}${location.pathname}?seznam=${encodeURIComponent(id)}`; }
async function renderPeople() {
  $('#people').innerHTML = '<li class="muted">Načítám…</li>';
  try {
    const people = await G.listPeople(state.list.id);
    const canEdit = state.list.ownedByMe;
    $('#people').innerHTML = people.map(p => `<li>
      <span><b>${esc(p.displayName || p.emailAddress)}</b> <span class="muted">${esc(p.emailAddress || '')}</span></span>
      <span class="role">${p.role === 'owner' ? 'vlastník' : 'může upravovat'}</span>
      ${canEdit && p.role !== 'owner' ? `<button type="button" class="ghost small" data-unshare="${esc(p.id)}">Odebrat</button>` : ''}
    </li>`).join('') || '<li class="muted">Zatím jen vy.</li>';
  } catch (e) {
    $('#people').innerHTML = `<li class="muted">Seznam lidí se nepodařilo načíst${e.offline ? ' (offline)' : ''}.</li>`;
  }
}
$('#btn-share').onclick = async () => {
  $('#form-share').reset();
  $('#share-link').textContent = shareLink(state.list.id);
  $('#dlg-share').showModal();
  try { await ensureAuth(); } catch (err) { return toast(err.message, 'error'); }
  renderPeople();
};
$('#btn-copy-link').onclick = async () => {
  try { await navigator.clipboard.writeText($('#share-link').textContent); toast('Odkaz zkopírován'); } catch { toast($('#share-link').textContent); }
};
$('#form-share').onsubmit = async e => {
  e.preventDefault();
  const email = e.target.email.value.trim();
  if (!email) return;
  try { await ensureAuth(); } catch (err) { return toast(err.message, 'error'); }
  busy(true);
  try {
    await G.shareList(state.list.id, email, shareLink(state.list.id), state.list.name);
    state.list.shared = true; saveLists();
    e.target.reset();
    toast(`Sdíleno s ${email}. Přijde mu e-mail s odkazem.`);
    renderPeople();
  } catch (err) { handleError(err); }
  finally { busy(false); }
};
$('#people').onclick = async e => {
  const b = e.target.closest('[data-unshare]');
  if (!b) return;
  try { await ensureAuth(); } catch (err) { return toast(err.message, 'error'); }
  try { await G.unshare(state.list.id, b.dataset.unshare); toast('Přístup odebrán'); renderPeople(); }
  catch (err) { handleError(err); }
};

// ---------- Nastavení ----------
$('#btn-settings').onclick = () => {
  $('#set-user').textContent = state.me.displayName ? `${state.me.displayName} (${state.me.emailAddress || ''})` : '—';
  $('#set-client').textContent = store.get(LS.client) || '—';
  const k = store.get(LS.key);
  $('#set-key').textContent = k ? `${k.slice(0, 8)}…${k.slice(-4)}` : '—';
  $('#set-origin').textContent = location.origin;
  $('#set-ver').textContent = new URL(import.meta.url).searchParams.get('v') || 'vývojová';
  updateInstallUi();
  $('#dlg-settings').showModal();
};
$('#btn-signout').onclick = async () => {
  await signOut();
  $('#dlg-settings').close();
  show('signin');
  toast('Odhlášeno');
};
$('#btn-reset').onclick = async () => {
  await signOut();
  $('#dlg-settings').close();
  setupIdx = 0;
  show('setup'); renderSetup();
};

// ---------- Instalace jako aplikace (PWA) ----------
let installPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function updateInstallUi() {
  const can = !!installPrompt && !isStandalone();
  $('#btn-install').hidden = !can;
  $('#btn-install-top').hidden = !can;
  $('#install-info').innerHTML = isStandalone()
    ? '✓ Odškrtník běží jako nainstalovaná aplikace.'
    : can ? 'Nainstalujte si Odškrtník jako aplikaci: ikona na ploše, spuštění na celou obrazovku.'
      : isIOS() ? 'Na iPhonu: v Safari <b>Sdílet</b> → <b>Přidat na plochu</b>.'
        : 'V Chromu na Androidu: menu <b>⋮</b> → <b>Nainstalovat aplikaci</b>. Na počítači: ikona instalace v adresním řádku.';
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; updateInstallUi(); });
window.addEventListener('appinstalled', () => { installPrompt = null; updateInstallUi(); toast('Odškrtník je nainstalovaný ✓'); });
async function doInstall() {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null; updateInstallUi();
}
$('#btn-install').onclick = doInstall;
$('#btn-install-top').onclick = doInstall;
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker:', err)));
}

// ---------- Start ----------
async function start() {
  if (location.protocol === 'file:') return show('file');
  const clientId = store.get(LS.client);
  if (!clientId || !store.get(LS.key)) {
    setupIdx = Math.min(Number(store.get(LS.step) || 0), SETUP.length - 1);
    show('setup'); renderSetup();
    return;
  }
  try { await initAuth(clientId); } catch (e) { toast(e.message, 'error'); }
  if (getStoredToken()) { await afterSignIn(); return; }
  // Bez přihlášení: když máme seznam v mezipaměti, ukážeme ho hned (offline, třeba na lodi).
  const last = store.get(LS.last);
  if (last && state.lists.some(l => l.id === last) && !new URLSearchParams(location.search).get('seznam')) {
    openList(last);
    toast('Seznam z paměti telefonu. Pro uložení změn se přihlaste.');
  } else show('signin');
}
start();
