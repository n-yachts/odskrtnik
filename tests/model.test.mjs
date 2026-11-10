// Unit testy logiky seznamu: node tests/model.test.mjs
import assert from 'node:assert/strict';
import { parseTypes, formatTypes, allTypes, inRun, groupByCategory, progress, neighbour, plural, TEMPLATES, templateItems } from '../js/model.js';
import { applyOp } from '../js/store.js';

// Typy výletu
assert.deepEqual(parseTypes('hory, moře; služební  cesta'), ['hory', 'moře', 'služební cesta']);
assert.deepEqual(parseTypes(' Hory , hory,,  '), ['Hory']);
assert.deepEqual(parseTypes('more, moře'), ['more']);            // bez diakritiky = stejný typ
assert.deepEqual(parseTypes(''), []);
assert.equal(formatTypes(['hory', 'moře']), 'hory, moře');

const it = (id, cat, types = [], done = false) => ({ id, cat, name: id, types, done });
const items = [
  it('pas', 'Doklady'), it('plavky', 'Oblečení', ['moře']), it('pohorky', 'Oblečení', ['hory'], true),
  it('karta', 'Doklady', [], true), it('oblek', 'Oblečení', ['Služební cesta']),
];
assert.deepEqual(allTypes(items), ['moře', 'hory', 'Služební cesta']);
assert.equal(inRun(items[0], ['hory']), true);                    // bez typu = vždy
assert.equal(inRun(items[1], ['hory']), false);
assert.equal(inRun(items[1], ['Moře']), true);
assert.equal(inRun(items[1], []), true);                          // průchod bez typů = vše
assert.equal(inRun(items[4], ['služební cesta']), true);

// Seskupení: kategorie v pořadí prvního výskytu, položky v pořadí řádků
const g = groupByCategory(items);
assert.deepEqual(g.map(x => x.name), ['Doklady', 'Oblečení']);
assert.deepEqual(g[0].items.map(x => x.id), ['pas', 'karta']);

assert.deepEqual(progress(items, ['hory']), { done: 2, total: 3, complete: false });
assert.deepEqual(progress(items, []), { done: 2, total: 5, complete: false });
assert.equal(progress([it('a', 'X', [], true)], []).complete, true);
assert.equal(progress([], []).complete, false);

// Posun v rámci kategorie přeskakuje jiné kategorie
assert.equal(neighbour(items, 'karta', -1).id, 'pas');
assert.equal(neighbour(items, 'pas', 1).id, 'karta');
assert.equal(neighbour(items, 'pas', -1), null);
assert.equal(neighbour(items, 'oblek', -1).id, 'pohorky');

assert.equal(plural(1, 'položka', 'položky', 'položek'), '1 položka');
assert.equal(plural(3, 'položka', 'položky', 'položek'), '3 položky');
assert.equal(plural(5, 'položka', 'položky', 'položek'), '5 položek');
assert.equal(plural(0, 'položka', 'položky', 'položek'), '0 položek');

// Předlohy
for (const t of TEMPLATES) {
  const list = templateItems(t.id);
  assert.equal(new Set(list.map(i => i.cat + '/' + i.name)).size, list.length, `duplicitní položka v ${t.id}`);
}
const bal = templateItems('baleni');
assert.deepEqual(allTypes(bal), ['hory', 'moře', 'služební cesta']);
assert.ok(bal.find(i => i.name === 'Opalovací krém').types.length === 2);
assert.ok(templateItems('vypluti').every(i => !i.types.length));
assert.equal(templateItems('prazdny').length, 0);

// Optimistické změny (fronta)
let l = applyOp(items, { op: 'tick', id: 'pas', done: true, by: 'Jan', at: 't' });
assert.equal(l[0].done && l[0].by, 'Jan');
l = applyOp(l, { op: 'tick', id: 'pas', done: false, by: 'Jan', at: 't' });
assert.equal(l[0].by, '');
l = applyOp(items, { op: 'swap', a: 'pas', b: 'karta' });
assert.deepEqual(l.map(i => i.id), ['karta', 'plavky', 'pohorky', 'pas', 'oblek']);
l = applyOp(items, { op: 'reset', run: {}, hist: null });
assert.ok(l.every(i => !i.done));
l = applyOp(items, { op: 'set', item: { ...items[0], name: 'Pas', done: false } });
assert.equal(l[0].name, 'Pas');
l = applyOp(items, { op: 'set', item: { ...items[2], name: 'Boty', done: false } });
assert.equal(l[2].done, true);                                     // úprava nemění zatržítko
l = applyOp(items, { op: 'del', ids: ['pas', 'oblek'] });
assert.equal(l.length, 3);

l = applyOp(items, { op: 'add', item: it('ridicak', 'Doklady') });
assert.deepEqual(l.map(i => i.id), ['pas', 'plavky', 'pohorky', 'karta', 'ridicak', 'oblek']);   // za poslední položku kategorie
l = applyOp(items, { op: 'add', item: it('lekarna', 'Zdraví') });
assert.equal(l[l.length - 1].id, 'lekarna');                        // nová kategorie na konec

console.log('všechny testy prošly');
