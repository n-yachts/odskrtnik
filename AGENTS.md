# AGENTS.md – Odškrtník

Informace pro AI agenty (a lidi): **co** aplikace dělá, **jak** a **proč** je to udělané takto.
Pravidla pro každou úpravu jsou v [`CLAUDE.md`](CLAUDE.md). Sesterské projekty se stejnou architekturou:
[Nákupník](https://github.com/n-yachts/nakupnik) (nejbližší – Google Tabulky, sdílení, fronta změn)
a [Lhůtník](https://github.com/n-yachts/lhutnik). Při nejasnostech se inspiruj tam.

- Web: https://n-yachts.github.io/odskrtnik/ (GitHub Pages z `main`), nápověda `help.html`
- Jazyk rozhraní, nápovědy i dokumentace: **čeština**

---

## 1. Co aplikace dělá

Opakovaně použitelné zaškrtávací seznamy. Uživatel (majitel lodi) chtěl dvě věci „na stejném principu“:

1. **Kontrolní seznam** (před vyplutím, zazimování) – odškrtává se a před dalším použitím se vynuluje.
2. **Balicí seznam na cesty** se **šablonami podle typu výletu** (hory, moře, služební cesta).

Obojí řeší jeden model: seznam = kategorie + položky; položka může mít **typy**; **průchod** (run) = jedno
použití seznamu s vybranými typy. Kontrolní seznam je prostě seznam bez typů.
Konfigurace (kategorie, položky, typy) je v Google Tabulce a jde upravovat i ručně.

Obrazovky: průvodce nastavením → přihlášení → **Moje seznamy** → **seznam** (postup, odškrtávání,
skrýt hotové; režim **úprav** s ▲▼) + dialogy *Začít znovu* (typy, název), položka, nový seznam (předlohy),
menu ⋯, historie, sdílení, nastavení; obrazovka **Zpřístupnit seznam** pro odkaz ze sdílení.

## 2. Architektura a proč

| Rozhodnutí | Proč |
|---|---|
| Statické HTML + ES moduly, bez buildu a závislostí, GitHub Pages | jako Lhůtník a Nákupník: zdarma, jednoduchá údržba |
| **Úložiště = Google Tabulka** (1 seznam = 1 tabulka) | uživatel chtěl konfiguraci „přes soubor na Google Disku“ se zatržítky v tabulce |
| Kategorie, položky **a** zatržítka v jednom listu `Položky` | jedna tabulka = celý seznam; zatržítko je skutečné políčko Tabulek (datová validace BOOLEAN), jde odškrtávat i v Tabulkách |
| Typy jako text `hory, moře` ve sloupci | nejjednodušší ruční úprava; žádná další tabulka typů, typ vznikne napsáním |
| Kategorie = text, pořadí podle prvního výskytu | ruční úprava bez číselníků; pořadí řádků = pořadí v aplikaci |
| Sdílení, `drive.file`, Picker, dotazování 15 s, fronta v `localStorage` | převzato z Nákupníku (viz jeho AGENTS.md); na lodi bývá slabý signál |
| Předpona `odskrtnik.`, port **8082**, manifest `id: /odskrtnik/` | Lhůtník (8080) a Nákupník (8081) běží na stejném originu `n-yachts.github.io` |

### Moduly (`js/`)

```
app.js ── UI: průvodce, seznamy, seznam, průchod, úpravy, dialogy, sdílení, nastavení, PWA
 ├─ store.js   ListStore: data z tabulky + fronta změn (add/set/tick/del/swap/reset), sync(), mezipaměť
 │   └─ google.js
 ├─ google.js  Drive v3 (soubory, appProperties, sdílení), Sheets v4 (hodnoty, vkládání řádků), Picker
 │   └─ auth.js   GIS token model (stejný jako v Nákupníku, jiný klíč tokenu)
 └─ model.js   parseTypes, inRun, groupByCategory, progress, neighbour, TEMPLATES (předlohy)
```

Importy mají `?v=verze` (doplňuje `tools/stamp.py`); všechny importy stejného modulu musí mít stejnou verzi.

## 3. Data

### Soubor seznamu
- Google Tabulka **`Odškrtník – <název>`** (`TITLE_PREFIX`), Drive `appProperties: { odskrtnik: '1', odskrtnikFolder: '1' }`,
  ve složce **Odškrtník** (`appProperties: { odskrtnik: 'folder' }`) – stejný mechanismus jako složka Nákupníku.
- List **`Položky`** (řádek 1 záhlaví): `id | kategorie | položka | poznámka | typy | hotovo | odškrtl | kdy` (`ITEM_COLUMNS`, A–H).
  `hotovo` = boolean (zaškrtávací políčko F2:F), `odškrtl` = křestní jméno, `kdy` = ISO čas (UTC, bez Z).
- List **`Stav`**: řádek 2 = aktuální průchod `typy | začato | začal | název`.
- List **`Historie`**: `začato | dokončeno | typy | hotovo | celkem | kdo | název` – připisuje se při *Začít znovu*,
  pokud bylo v průchodu něco odškrtnuto.

**Neměnit** názvy listů, pořadí sloupců, `appProperties` ani prefix názvu – existující seznamy by se ztratily.

### Ruční úpravy tabulky (`readList`)
Řádek s vyplněnou *položkou* je položka. Chybí-li `id`, aplikace ho vygeneruje; prázdná `kategorie` = kategorie
řádku nad ním (první řádek → „Ostatní“). Obojí se hned zapíše zpět do A:B, takže tabulka je pak explicitní.

### Zápisy (vždy podle `id`, ne podle čísla řádku)
Řádek se hledá čtením sloupce A těsně před zápisem. Úprava položky píše jen **B–E**, odškrtnutí jen **F–H** –
souběžné odškrtnutí a úprava názvu se nepřepíšou. Nová položka se **vloží za poslední řádek své kategorie**
(`insertDimension` s `inheritFromBefore`, aby řádek dostal zaškrtávací políčko), nová kategorie na konec.
Posun ▲▼ = prohození obsahu dvou řádků (`swapItems`). *Začít znovu* (`resetRun`) = Historie (append) → Stav → F2:H prázdné.

### Chyby API
Stejně jako Nákupník: nepovolené API → česká hláška; 429/kvóty → jako offline; jiné 403/404 → `NoAccessError`.

### V prohlížeči (`localStorage`)
`odskrtnik.clientId`, `.apiKey`, `.setupStep`, `.lastList`, `.lists`, `.hidden`, `.me`, `.hideDone`,
`odskrtnik.cache.<id>` (položky + stav průchodu), `odskrtnik.pending.<id>` (fronta). Token v `sessionStorage` `odskrtnik.token`.

## 4. Hlavní toky

- **Nový seznam:** dialog s předlohami (`TEMPLATES` v `model.js`) → `createList(name, items)`: soubor, listy,
  validace BOOLEAN, záhlaví + položky + Stav jedním `values:batchUpdate`. Prázdná předloha otevře rovnou úpravy.
- **Odškrtnutí:** `store.tick` → optimisticky hned, ve frontě `tickItem` (F:H).
- **Odeslané, nepotvrzené změny (`store.sent`):** po odeslání se změna dál zobrazuje, dokud ji načtená data
  nepotvrdí (`confirmed()` v `store.js`), nejdéle 60 s. Google těsně po zápisu občas vrátí starší stav a bez toho
  rychle odškrtnuté položky „odskakovaly“ zpět. Proto musí být každá operace v `applyOp` **opakovatelná**
  (použití na už změněná data nic nezmění – i `swap` nese `after`). Test: `g.stale` v `tools/fakegoogle.py`.
  Požadavky na API mají `cache: 'no-store'`.
- **Začít znovu:** dialog s typy (`allTypes`) a názvem → `store.reset(run, hist)`; předvyplní typy minulého průchodu,
  ukazuje počet položek (`progress(items, typy).total`).
- **Co je v průchodu:** `inRun` – položka bez typů vždy; průchod bez typů = vše; jinak průnik (bez ohledu na
  velikost písmen a diakritiku).
- **Úpravy:** režim `state.editMode` ukazuje všechny položky (mimo průchod zešedlé), ▲▼ jen v rámci kategorie (`neighbour`).
- Přihlášení, sdílení, Picker, offline start: jako Nákupník.

## 5. PWA, mezipaměť, verze

`manifest.webmanifest` (**`id` musí zůstat `/odskrtnik/`**), `sw.js` („nejdřív síť“, mezipaměť `odskrtnik-<VERSION>`),
ikony z `tools/icons.py` (deska se zaškrtávacím seznamem, námořní modrá `#1f5f8b`). Před nasazením `python tools/stamp.py`.

## 6. Testy a nasazení

| Co | Jak |
|---|---|
| Logika | `node tests/model.test.mjs` |
| Celá aplikace | `python tests/e2e.py` – Playwright proti `tools/fakegoogle.py`: předloha, průchod s typy, odškrtávání, úpravy (vložení do kategorie, posun, smazání), ruční úprava tabulky, historie, sdílení přes Picker, offline fronta, nepovolené API, seznam bez typů, prázdný seznam |
| Náhledy | `python tools/screenshots.py` → `help/img/` (prohlédni je) |
| Skutečný Google | automaticky nejde; změny API ověř ručně (hlavně validaci BOOLEAN a `insertDimension`) |
| Lokálně | `start.cmd` (port 8082) nebo `python -m http.server 8082` |
| Nasazení | push do `main` → GitHub Pages |

## 7. Konvence

Česky, bez závislostí, žádné `alert/confirm` (mazání = druhé klepnutí), uživatelská data do HTML jen přes `esc()`,
velké dotykové plochy (celý řádek je zatržítko – používá se jednou rukou na palubě), světlý i tmavý režim.

## 8. Omezení a nápady

- Zpoždění změn od ostatních až 15 s. Souběžné úpravy: poslední zápis vyhrává.
- Jeden průchod na seznam najednou (dvě souběžné cesty = dvě kopie seznamu).
- Přejmenování celé kategorie jen po položkách nebo v Tabulkách.
- Nápady: kopie seznamu, přesun celé kategorie, připomenutí (např. zazimovat do konce října),
  položky s množstvím („trička ×5“ podle počtu dní), Wake Lock při kontrole.
