# Odškrtník

Zaškrtávací seznamy, které se dají opakovaně odškrtávat a pokaždé vynulovat: **kontrola před vyplutím**,
**zazimování lodi**, **balení na cesty** (s typy výletu – hory, moře, služební cesta). Seznamy se ukládají
do **Google Tabulek** ve složce *Odškrtník* ve vašem Disku; upravovat je jde v aplikaci i přímo v Tabulkách.

**Web:** https://n-yachts.github.io/odskrtnik/ · 📖 **Nápověda s obrázky:**
[help.html](https://n-yachts.github.io/odskrtnik/help.html)

## Co umí

- **Více seznamů** z předloh (Před vyplutím, Zazimování lodi, Balení na cesty) nebo prázdných; přehled s postupem.
- **Odškrtávání** klepnutím na řádek, postup (6 / 31), kategorie se sbalují, „skrýt hotové“.
- **Začít znovu:** vynuluje všechna zatržítka; volitelně název průchodu („Krkonoše – leden“).
- **Typy výletu:** položka může mít typy (`hory, moře`); při startu vyberete jeden či více typů
  a v seznamu jsou jen položky bez typu + položky s vybraným typem.
- **Historie průchodů:** kdy, jaké typy, kolik bylo odškrtnuto.
- **Úpravy:** přidání, úprava (kategorie, typy, poznámka), smazání a posun ▲▼ v rámci kategorie.
- **Konfigurace v Google Tabulce:** list *Položky* (kategorie, položka, poznámka, typy, zaškrtávací políčko *hotovo*);
  ručně dopsané řádky aplikace převezme (doplní id, prázdná kategorie = kategorie řádku nad).
- **Sdílení e-mailem** s posádkou nebo rodinou; u odškrtnuté položky je vidět, kdo ji odškrtl.
- **Bez signálu:** seznam je uložený v telefonu, změny počkají a odešlou se po připojení; změny ostatních každých 15 s.
- **Instalace do telefonu** jako aplikace (PWA), světlý i tmavý režim.

## Spuštění

- **Web:** https://n-yachts.github.io/odskrtnik/
- **Lokálně (Windows):** dvojklik na `start.cmd` → `http://localhost:8082`

Při prvním spuštění provede **průvodce** nastavením Google Cloud: projekt, souhlasová obrazovka,
Client ID (webová aplikace), povolit **Google Drive API, Google Sheets API a Google Picker API** a vytvořit **API klíč**
omezený na `https://n-yachts.github.io/*`, `http://localhost:8082/*` a Google Picker API.

## Oprávnění

Jen `https://www.googleapis.com/auth/drive.file` – aplikace vidí jen tabulky, které sama založila
nebo které jí uživatel ukázal v okně Google Disku (Picker). Ostatní soubory nevidí.

## Soubory

```
index.html, styles.css    aplikace
help.html, help/img/      nápověda s náhledy obrazovek
js/app.js                 rozhraní: průvodce, seznamy, odškrtávání, průchody, úpravy, sdílení, nastavení
js/model.js               typy výletu, seskupení, postup, předlohy seznamů
js/store.js               stav seznamu, fronta neodeslaných změn, synchronizace
js/google.js              Drive API, Sheets API, Google Picker
js/auth.js                přihlášení přes Google
manifest.webmanifest, sw.js, icons/   instalace jako aplikace (PWA)
server.ps1, start.cmd     lokální server na portu 8082
tools/                    fakegoogle.py (napodobený Google), screenshots.py, stamp.py, icons.py
tests/                    model.test.mjs (node), e2e.py (Playwright)
AGENTS.md                 pro AI agenty a vývojáře: co, jak a proč
CLAUDE.md                 pravidla pro každou úpravu
```

## Vývoj

```
node tests/model.test.mjs     # logika: typy, seskupení, postup, předlohy, fronta změn
python tests/e2e.py           # celá aplikace proti napodobenému Googlu (2 uživatelé, sdílení, offline)
python tools/screenshots.py   # náhledy do nápovědy
python tools/stamp.py         # nová verze souborů (mezipaměť)
```

Nasazení: push do `main` → GitHub Pages.
