// Stav jednoho seznamu: data z tabulky + fronta změn, které ještě nedošly do Googlu.
// Změny se ukazují hned (optimisticky) a odesílají se postupně; bez signálu čekají
// v localStorage a odešlou se po připojení. Při souběžné úpravě vyhrává poslední zápis.
//
// Odeslaná změna se dál zobrazuje, dokud ji načtená data z Googlu nepotvrdí (nejdéle SENT_MS).
// Google totiž těsně po zápisu občas vrátí ještě starší stav – bez toho by rychle odškrtnutá
// položka na chvíli „odskočila“ zpět a znovu se odškrtla až při dalším načtení.
import * as G from './google.js?v=20261110-1119';

const KEY = { cache: id => `odskrtnik.cache.${id}`, pending: id => `odskrtnik.pending.${id}` };
const load = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const nowIso = () => new Date().toISOString().slice(0, 19);
const EMPTY_RUN = { types: [], started: '', by: '', title: '' };
const SENT_MS = 60_000;

export class ListStore {
  constructor(listId, { onChange } = {}) {
    this.id = listId;
    this.onChange = onChange || (() => {});
    const c = load(KEY.cache(listId), {});
    this.server = c.items || [];
    this.serverRun = c.run || { ...EMPTY_RUN };
    this.syncedAt = c.syncedAt || '';
    this.pending = load(KEY.pending(listId), []);
    this.sent = [];           // odeslané, zatím nepotvrzené změny: { op, t }
    this.status = 'idle';     // idle | syncing | offline | error
    this.error = '';
    this.busy = false;
  }

  /** Položky tak, jak je vidí uživatel: data z Googlu + neodeslané změny. */
  get items() {
    let list = this.server.map(i => ({ ...i }));
    for (const op of this.ops()) list = applyOp(list, op);
    return list;
  }

  /** Aktuální průchod (typy výletu, kdy a kdo začal). */
  get run() {
    let run = this.serverRun;
    for (const op of this.ops()) if (op.op === 'reset') run = op.run;
    return run;
  }

  ops() { return [...this.sent.map(s => s.op), ...this.pending]; }

  get known() { return !!this.syncedAt || this.pending.length > 0; }

  persist() {
    save(KEY.cache(this.id), { items: this.server, run: this.serverRun, syncedAt: this.syncedAt });
    save(KEY.pending(this.id), this.pending);
  }

  queue(op) {
    this.pending.push(op);
    this.persist();
    this.onChange();
    this.sync();
  }

  add(item) { this.queue({ op: 'add', item }); }
  update(item) { this.queue({ op: 'set', item }); }
  tick(id, done, by) { this.queue({ op: 'tick', id, done, by, at: nowIso() }); }
  remove(ids) { this.queue({ op: 'del', ids }); }
  swap(a, b) {
    const items = this.items;
    // after = po prohození bude a pod b; díky tomu jde změnu použít opakovaně bez vrácení
    this.queue({ op: 'swap', a, b, after: items.findIndex(i => i.id === a) < items.findIndex(i => i.id === b) });
  }
  /** Nový průchod: vynuluje zatržítka; hist = shrnutí předchozího průchodu do Historie (nebo null). */
  reset(run, hist) { this.queue({ op: 'reset', run, hist }); }

  /** Odešle frontu a načte aktuální stav. Bezpečné volat kdykoli (souběh se ignoruje). */
  async sync() {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    this.status = 'syncing'; this.onChange();
    try {
      do {
        this.again = false;
        await this.flush();
        const data = await G.readList(this.id);
        this.server = data.items;
        this.serverRun = data.run;
        const now = Date.now();
        this.sent = this.sent.filter(s => now - s.t < SENT_MS && !confirmed(s.op, data.items, data.run));
        this.syncedAt = nowIso();
        this.persist();
      } while (this.again);
      this.status = 'idle'; this.error = '';
    } catch (e) {
      if (e instanceof G.AuthError || e instanceof G.NoAccessError) { this.status = 'error'; this.error = e.message; this.busy = false; this.onChange(); throw e; }
      this.status = e.offline || !navigator.onLine ? 'offline' : 'error';
      this.error = e.message;
    } finally {
      this.busy = false;
      this.onChange();
    }
  }

  async flush() {
    while (this.pending.length) {
      const op = this.pending[0];
      if (op.op === 'add') await G.appendItem(this.id, op.item);
      else if (op.op === 'set') await G.updateItem(this.id, op.item);       // smazanou položku přeskočí
      else if (op.op === 'tick') await G.tickItem(this.id, op.id, op.done, op.by, op.at);
      else if (op.op === 'del') await G.deleteItems(this.id, op.ids);
      else if (op.op === 'swap') await G.swapItems(this.id, op.a, op.b);
      else if (op.op === 'reset') await G.resetRun(this.id, op.run, op.hist);
      this.sent.push({ op: this.pending.shift(), t: Date.now() });
      this.persist();
    }
  }
}

export function applyOp(list, op) {
  switch (op.op) {
    case 'add': {
      if (list.some(i => i.id === op.item.id)) return list;
      // stejně jako v tabulce: za poslední položku stejné kategorie
      const at = list.map(i => i.cat).lastIndexOf(op.item.cat);
      return at < 0 ? [...list, { ...op.item }] : [...list.slice(0, at + 1), { ...op.item }, ...list.slice(at + 1)];
    }
    case 'set': return list.map(i => (i.id === op.item.id ? { ...i, cat: op.item.cat, name: op.item.name, note: op.item.note, types: op.item.types } : i));
    case 'tick': return list.map(i => (i.id === op.id ? { ...i, done: op.done, by: op.done ? op.by : '', at: op.done ? op.at : '' } : i));
    case 'del': return list.filter(i => !op.ids.includes(i.id));
    case 'swap': {
      const a = list.findIndex(i => i.id === op.a), b = list.findIndex(i => i.id === op.b);
      if (a < 0 || b < 0) return list;
      if (op.after !== undefined && (a > b) === op.after) return list;   // už prohozeno
      const out = [...list];
      [out[a], out[b]] = [out[b], out[a]];
      return out;
    }
    case 'reset': return list.map(i => ({ ...i, done: false, by: '', at: '' }));
    default: return list;
  }
}

/** Obsahují načtená data už odeslanou změnu? */
export function confirmed(op, items, run) {
  const find = id => items.find(i => i.id === id);
  switch (op.op) {
    case 'tick': { const i = find(op.id); return !i || i.done === !!op.done; }
    case 'set': {
      const i = find(op.item.id);
      return !i || (i.name === op.item.name && i.cat === op.item.cat && (i.note || '') === (op.item.note || '')
        && (i.types || []).join(',') === (op.item.types || []).join(','));
    }
    case 'add': return !!find(op.item.id);
    case 'del': return !op.ids.some(find);
    case 'swap': {
      const a = items.findIndex(i => i.id === op.a), b = items.findIndex(i => i.id === op.b);
      return a < 0 || b < 0 || op.after === undefined || (a > b) === op.after;
    }
    case 'reset': return run?.started === op.run.started;
    default: return true;
  }
}

/** Smaže uložená data seznamu z prohlížeče (např. když se seznam odebere). */
export function forgetList(id) {
  try { localStorage.removeItem(KEY.cache(id)); localStorage.removeItem(KEY.pending(id)); } catch {}
}
