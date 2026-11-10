// Logika seznamu bez závislosti na Googlu a na stránce (testuje ji tests/model.test.mjs):
// typy výletu (šablony), co patří do aktuálního průchodu, seskupení podle kategorií, postup
// a předlohy nových seznamů.

/** „hory, moře; služební cesta“ → ['hory', 'moře', 'služební cesta'] (bez prázdných a duplicit). */
export function parseTypes(text) {
  const out = [];
  for (const t of String(text ?? '').split(/[,;]/)) {
    const v = t.trim().replace(/\s+/g, ' ');
    if (v && !out.some(x => sameType(x, v))) out.push(v);
  }
  return out;
}
export const formatTypes = types => (types || []).join(', ');
const norm = s => String(s ?? '').trim().toLocaleLowerCase('cs').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const sameType = (a, b) => norm(a) === norm(b);

/** Všechny typy použité v seznamu, v pořadí prvního výskytu. */
export function allTypes(items) {
  const out = [];
  for (const i of items) for (const t of i.types || []) if (!out.some(x => sameType(x, t))) out.push(t);
  return out;
}

/** Patří položka do průchodu? Položka bez typů patří vždy; průchod bez typů obsahuje vše. */
export function inRun(item, runTypes) {
  if (!item.types?.length || !runTypes?.length) return true;
  return item.types.some(t => runTypes.some(r => sameType(r, t)));
}

/** Kategorie v pořadí prvního výskytu v tabulce; položky v nich v pořadí řádků. */
export function groupByCategory(items) {
  const groups = new Map();
  for (const i of items) {
    const c = i.cat || 'Ostatní';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(i);
  }
  return [...groups.entries()].map(([name, list]) => ({ name, items: list }));
}

export function progress(items, runTypes) {
  const run = items.filter(i => inRun(i, runTypes));
  const done = run.filter(i => i.done).length;
  return { done, total: run.length, complete: run.length > 0 && done === run.length };
}

/** Soused v rámci stejné kategorie (pro posun ↑ ↓). */
export function neighbour(items, id, dir) {
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0) return null;
  const cat = items[idx].cat;
  for (let j = idx + dir; j >= 0 && j < items.length; j += dir) {
    if (items[j].cat === cat) return items[j];
  }
  return null;
}

export const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

// ---------- Předlohy nových seznamů ----------
// [kategorie, [položka | [položka, typy, poznámka]]]

const VYPLUTI = [
  ['Motor', ['Olej v motoru', 'Chladicí kapalina / filtr mořské vody', ['Palivo', '', 'dost na plánovanou trasu + rezerva'], 'Řemen alternátoru', 'Po nastartování teče chladicí voda z výfuku']],
  ['Loď', ['Průchodky a ventily (WC, umyvadlo) v pořádku', 'Stoka suchá, stokové čerpadlo funguje', 'Kotva a kotevní řetěz připravené', 'Okna a poklopy zavřené', 'Volné věci v kajutě uklizené']],
  ['Bezpečnost', ['Záchranné vesty pro všechny', 'Záchranný kruh a házecí lano', 'Lékárnička', 'Hasicí přístroj', 'Plyn zavřený']],
  ['Navigace a spojení', ['Předpověď počasí', 'Plán trasy a přístav pro případ nouze', 'VHF – test, kanál 16', 'Navigační světla fungují', 'Telefon nabitý, offline mapy']],
  ['Posádka', ['Bezpečnostní instruktáž (vesty, MOB, hasicí přístroj)', 'Rozdělení úkolů při odplutí', 'Voda a jídlo na palubě']],
  ['Odplutí', ['Odpojit přípojku 230 V', 'Odpojit hadici s vodou', 'Fendry a lana připravené', 'Zapsat do lodního deníku']],
];

const ZAZIMOVANI = [
  ['Motor', ['Výměna oleje a olejového filtru', 'Nemrznoucí směs do chladicího okruhu', 'Vyjmout impeller', 'Palivová nádrž plná + aditivum', 'Odvodnit odlučovač vody z paliva', 'Zakonzervovat motor podle návodu']],
  ['Voda a sanita', ['Vypustit nádrže na pitnou vodu', 'Vypustit bojler', 'Nemrznoucí směs do WC a odpadů', 'Otevřít kohoutky a ventily', 'Vyprázdnit fekální nádrž']],
  ['Elektro', ['Baterie nabít', 'Baterie odpojit (nebo udržovací nabíječka)', 'Odpojit přípojku 230 V', 'Vypnout hlavní vypínač']],
  ['Interiér', ['Vyklidit potraviny a nápoje', 'Matrace a polštáře postavit / odvézt', 'Vysoušeč vlhkosti', 'Lednici nechat otevřenou', 'Odvézt elektroniku a cennosti']],
  ['Paluba a plachty', ['Sundat plachty, usušit, uložit', 'Lana opláchnout a usušit', 'Zakrýt loď plachtou', 'Fendry a příslušenství uklidit']],
  ['Papíry', ['Vyfotit stav lodi', 'Doklady lodi odvézt domů', 'Zkontrolovat pojištění přes zimu']],
];

const H = 'hory', M = 'moře', S = 'služební cesta';
const BALENI = [
  ['Doklady a peníze', ['Občanka / pas', 'Platební karta a hotovost', ['Cestovní pojištění', `${H}, ${M}`], 'Jízdenky, letenky, rezervace', ['Řidičák', '', 'když se jede autem'], ['Služební průkaz / cestovní příkaz', S]]],
  ['Oblečení', ['Spodní prádlo a ponožky', 'Trička', 'Pyžamo', ['Plavky', M], ['Nepromokavá bunda', H], ['Fleece / teplá vrstva', H], ['Pohorky', H], ['Čepice a rukavice', H], ['Sandály', M], ['Kraťasy a lehké šaty', M], ['Oblek / košile', S], ['Společenské boty', S]]],
  ['Hygiena a zdraví', ['Kartáček a pasta', 'Deodorant', 'Léky, které beru', ['Opalovací krém', `${H}, ${M}`], ['Lékárnička', `${H}, ${M}`], ['Repelent', M]]],
  ['Elektronika', ['Telefon a nabíječka', 'Powerbanka', 'Sluchátka', ['Notebook a nabíječka', S], ['Adaptér do zásuvky', '', 'do zahraničí']]],
  ['Výbava', ['Láhev na vodu', ['Sluneční brýle', `${H}, ${M}`], ['Batoh', H], ['Čelovka', H], ['Offline mapy', H], ['Plážový ručník', M], ['Šnorchl a brýle', M], ['Vizitky', S], ['Podklady na jednání', S]]],
  ['Před odjezdem', ['Zavřít vodu a plyn', 'Vynést odpadky', 'Zalít kytky', 'Zavřít okna', 'Vypnout spotřebiče ze zásuvky']],
];

export const TEMPLATES = [
  { id: 'vypluti', name: 'Před vyplutím', icon: '⛵', desc: 'kontrola lodi, bezpečnost, odplutí', data: VYPLUTI },
  { id: 'zazimovani', name: 'Zazimování lodi', icon: '❄️', desc: 'motor, voda, elektro, interiér', data: ZAZIMOVANI },
  { id: 'baleni', name: 'Balení na cesty', icon: '🧳', desc: 'typy výletu: hory, moře, služební cesta', data: BALENI },
  { id: 'prazdny', name: 'Prázdný seznam', icon: '📝', desc: 'položky si přidáte sami', data: [] },
];

/** Položky předlohy ve tvaru {cat, name, types, note} (bez id). */
export function templateItems(id) {
  const t = TEMPLATES.find(x => x.id === id);
  if (!t) return [];
  return t.data.flatMap(([cat, list]) => list.map(x => {
    const [name, types = '', note = ''] = Array.isArray(x) ? x : [x];
    return { cat, name, types: parseTypes(types), note };
  }));
}
