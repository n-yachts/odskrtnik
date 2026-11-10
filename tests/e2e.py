"""
Smoke test celé aplikace proti napodobenému Googlu (tools/fakegoogle.py):
dva uživatelé, složka Odškrtník, seznam z předlohy, nový průchod s typy výletu, odškrtávání,
úpravy položek (přidání, posun, smazání), ruční úprava tabulky, historie, sdílení přes Picker,
synchronizace, offline fronta, nepovolené API.

    pip install playwright && playwright install chromium
    python tests/e2e.py
"""
import functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from fakegoogle import FakeGoogle  # noqa: E402

PORT = 8092
CLIENT = '123456789012-test.apps.googleusercontent.com'
KEY = 'AIzaSyTESTKEY0123456789abcdefghijklmnop'
SAVED = "document.querySelector('#sync').textContent.includes('Uloženo')"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def main():
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://localhost:{PORT}/'
    g = FakeGoogle()
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch()

        def page_for(user):
            ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(f'{user}: {e}'))
            pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(f'{user} console: {m.text}'))
            g.install(pg)
            pg.add_init_script(f"window.__fakeUser = '{user}';")
            pg.goto(base)
            pg.evaluate(f"localStorage.setItem('odskrtnik.clientId','{CLIENT}'); localStorage.setItem('odskrtnik.apiKey','{KEY}')")
            pg.reload()
            pg.click('#btn-signin')
            return ctx, pg

        def saved(pg):
            pg.wait_for_function(SAVED)

        def resync(pg):
            pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
            saved(pg)

        def names(pg):
            return [x.text_content() for x in pg.query_selector_all('#items .it-name')]

        # --- A založí seznam z předlohy Balení na cesty ---
        ctxA, a = page_for('a')
        a.wait_for_selector('#view-lists:not([hidden])')
        a.click('#btn-new-list')
        assert a.input_value('#form-list [name=name]') == 'Před vyplutím'
        a.click('[data-tpl="baleni"]')
        assert a.input_value('#form-list [name=name]') == 'Balení na cesty'
        a.click('#btn-list-save')
        a.wait_for_selector('#view-list:not([hidden])')
        saved(a)
        fid = next(k for k, f in g.files.items() if f['name'] == 'Odškrtník – Balení na cesty')
        sh = g.files[fid]['sheets']
        assert list(sh) == ['Položky', 'Stav', 'Historie'], list(sh)
        assert sh['Položky'][0][:6] == ['id', 'kategorie', 'položka', 'poznámka', 'typy', 'hotovo']
        assert any(r[2] == 'Plavky' and r[4] == 'moře' and r[5] is False for r in sh['Položky'][1:])
        total = len(sh['Položky']) - 1
        assert a.inner_text('.run-count').replace(' ', '') == f'0/{total}', a.inner_text('.run-count')
        folders = [k for k, f in g.files.items() if f.get('mimeType') == 'application/vnd.google-apps.folder']
        assert len(folders) == 1 and g.files[fid]['parents'] == folders

        # --- Nový průchod: hory ---
        a.click('#btn-new-run')
        assert a.is_visible('#run-types-wrap')
        a.click('[data-rtype="hory"]')
        summary = a.inner_text('#run-summary')
        a.fill('#form-run [name=title]', 'Krkonoše')
        a.click('#form-run [type=submit]')
        saved(a)
        assert sh['Stav'][1][0] == 'hory' and sh['Stav'][1][3] == 'Krkonoše', sh['Stav']
        shown = names(a)
        assert 'Pohorky' in shown and 'Plavky' not in shown and 'Oblek / košile' not in shown and 'Občanka / pas' in shown
        assert summary.startswith(str(len(shown))), (summary, len(shown))

        # --- Odškrtávání ---
        a.click('.tick:has-text("Občanka / pas")'); a.click('.tick:has-text("Pohorky")')
        saved(a)
        row = next(r for r in sh['Položky'] if r[2] == 'Pohorky')
        assert row[5] is True and row[6] == 'Jan', row
        assert a.inner_text('.run-count').startswith('2')
        a.click('.tick:has-text("Pohorky")'); saved(a)
        assert next(r for r in sh['Položky'] if r[2] == 'Pohorky')[5] is False
        a.click('.tick:has-text("Pohorky")'); saved(a)

        # --- Rychlé odškrtávání, Google po zápisu chvíli vrací starší data ---
        import copy
        quick = ['Spodní prádlo a ponožky', 'Trička', 'Pyžamo', 'Nepromokavá bunda']
        g.stale = {fid: copy.deepcopy(sh)}
        for n in quick:
            a.click(f'.tick:has-text("{n}")')
        saved(a)
        resync(a)                                                        # i další načtení je ještě staré
        for n in quick:
            assert next(r for r in sh['Položky'] if r[2] == n)[5] is True, n
            assert a.locator(f'.item.done:has-text("{n}")').count() == 1, f'odskočilo: {n}'
        g.stale = None
        resync(a)
        for n in quick:
            assert a.locator(f'.item.done:has-text("{n}")').count() == 1, n
        a.click('.tick:has-text("Pyžamo")'); saved(a)                    # po potvrzení jde normálně vrátit
        assert a.locator('.item.done:has-text("Pyžamo")').count() == 0
        assert next(r for r in sh['Položky'] if r[2] == 'Pyžamo')[5] is False

        # Skrýt hotové
        a.check('#chk-hide')
        assert 'Pohorky' not in names(a)
        a.uncheck('#chk-hide')

        # --- Úpravy: přidat, posunout, upravit, smazat ---
        a.click('#btn-list-menu'); a.click('#m-edit')
        assert a.is_visible('#edit-bar') and 'Plavky' in names(a)       # v úpravách jsou vidět všechny položky
        a.click('[data-add="Výbava"]')
        a.fill('#form-item [name=name]', 'Mačky')
        a.click('#item-types [data-itype="hory"]')
        assert a.input_value('#form-item [name=types]') == 'hory'
        a.click('#btn-item-save'); saved(a)
        rows = [r[2] for r in sh['Položky']]
        i = rows.index('Mačky')
        assert sh['Položky'][i][1:5] == ['Výbava', 'Mačky', '', 'hory'] and rows[i - 1] == 'Podklady na jednání', rows
        assert sh['Položky'][-1][1] == 'Před odjezdem'                   # vloženo do své kategorie, ne na konec
        a.click('.item:has-text("Mačky") [data-dir="-1"]'); saved(a)
        rows = [r[2] for r in sh['Položky']]
        assert rows.index('Mačky') == i - 1, rows
        a.click('[data-edit]:has-text("Mačky")')
        a.fill('#form-item [name=note]', 'jen v zimě'); a.click('#btn-item-save'); saved(a)
        assert next(r for r in sh['Položky'] if r[2] == 'Mačky')[3] == 'jen v zimě'
        a.click('[data-edit]:has-text("Šnorchl a brýle")')
        a.click('#btn-item-delete'); a.click('#btn-item-delete'); saved(a)
        assert not any(r[2] == 'Šnorchl a brýle' for r in sh['Položky'])
        a.click('#btn-edit-done')
        assert 'Mačky' in names(a)

        # --- Ruční úprava tabulky: řádek bez id a kategorie, zatržítko v Tabulkách ---
        i = [r[2] for r in sh['Položky']].index('Mačky')
        sh['Položky'].insert(i + 2, ['', '', 'Lavinový vyhledávač', '', 'hory'])
        next(r for r in sh['Položky'] if r[2] == 'Čelovka')[5] = True
        resync(a)
        added = sh['Položky'][i + 2]
        assert added[0] and added[1] == 'Výbava', added                    # doplněné id a kategorie z řádku nad
        assert a.locator('.item.done:has-text("Čelovka")').count() == 1
        assert a.locator('.item:has-text("Lavinový vyhledávač")').count() == 1

        # --- Sdílení s B ---
        a.click('#btn-share'); a.fill('#form-share [name=email]', 'jana@example.com'); a.click('#form-share [type=submit]')
        a.wait_for_selector('#people li:has-text("Jana")')
        link = a.inner_text('#share-link')
        a.click('#dlg-share [data-close]')

        ctxB, bpg = page_for('b')
        bpg.wait_for_selector('#view-lists:not([hidden])')
        bpg.evaluate(f"window.__pickId = '{fid}'")
        bpg.goto(link.replace(f'http://localhost:{PORT}/', base))
        bpg.add_init_script(f"window.__pickId = '{fid}';")
        bpg.wait_for_selector('#view-grant:not([hidden])')
        bpg.evaluate(f"window.__pickId = '{fid}'")
        bpg.click('#btn-grant')
        bpg.wait_for_selector('#view-list:not([hidden])')
        saved(bpg)
        assert 'Krkonoše' in bpg.inner_text('#run')                      # B vidí stejný průchod
        bpg.click('.tick:has-text("Batoh")'); saved(bpg)
        resync(a)
        assert 'Jana' in a.inner_text('.item:has-text("Batoh")')

        # --- Offline: odškrtnutí počká ---
        ctxB.set_offline(True); g.offline.add('b')
        bpg.click('.tick:has-text("Láhev na vodu")')
        bpg.wait_for_function("document.querySelector('#sync').textContent.includes('Offline')")
        assert next(r for r in sh['Položky'] if r[2] == 'Láhev na vodu')[5] is False
        assert bpg.locator('.item.done:has-text("Láhev na vodu")').count() == 1
        ctxB.set_offline(False); g.offline.discard('b')
        bpg.evaluate("window.dispatchEvent(new Event('online'))")
        saved(bpg)
        assert next(r for r in sh['Položky'] if r[2] == 'Láhev na vodu')[5] is True

        # --- Nepovolené API: hláška, seznam zůstane ---
        g.disabled = True
        a.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        a.wait_for_function("document.querySelector('#sync').textContent.includes('není povolené')")
        assert a.is_visible('#view-list') and len(names(a)) > 0
        g.disabled = False
        resync(a)

        # --- Začít znovu: historie a vynulování ---
        done_before = int(a.inner_text('.run-count').split('/')[0])
        a.click('#btn-new-run')
        assert 'uloží do historie' in a.inner_text('#run-intro')
        assert a.locator('#run-types .chip.on').count() == 1               # předvybrané typy minulého průchodu
        a.click('[data-rtype="hory"]'); a.click('[data-rtype="moře"]')
        a.click('#form-run [type=submit]'); saved(a)
        assert all(r[5] is False for r in sh['Položky'][1:]), [r for r in sh['Položky'][1:] if r[5] is not False]
        hist = sh['Historie'][1:]
        assert len(hist) == 1 and hist[0][2] == 'hory' and hist[0][3] == done_before and hist[0][6] == 'Krkonoše', hist
        assert sh['Stav'][1][0] == 'moře'
        assert 'Plavky' in names(a) and 'Pohorky' not in names(a)
        a.click('#btn-list-menu'); a.click('#m-history')
        a.wait_for_selector('#history li:has-text("Krkonoše")')
        a.click('#dlg-history [data-close]')

        # --- Druhý seznam bez typů: Před vyplutím ---
        a.click('#btn-back')
        a.wait_for_selector('.list-card:has-text("Balení na cesty")')
        assert 'moře' in a.inner_text('.list-card:has-text("Balení na cesty")')
        a.click('#btn-new-list'); a.click('#btn-list-save')
        a.wait_for_selector('#view-list:not([hidden])'); saved(a)
        for n in names(a):
            a.click(f'.tick:has-text("{n}")')
        saved(a)
        assert a.locator('.run.complete').count() == 1 and 'Vše odškrtnuto' in a.inner_text('#run')
        a.click('#btn-new-run')
        assert a.is_hidden('#run-types-wrap')
        a.click('#form-run [type=submit]'); saved(a)
        assert a.locator('.item.done').count() == 0
        folders = [k for k, f in g.files.items() if f.get('mimeType') == 'application/vnd.google-apps.folder']
        assert len(folders) == 1, folders

        # --- Prázdný seznam otevře úpravy ---
        a.click('#btn-back'); a.click('#btn-new-list'); a.click('[data-tpl="prazdny"]')
        assert a.input_value('#form-list [name=name]') == ''
        a.fill('#form-list [name=name]', 'Chata'); a.click('#btn-list-save')
        a.wait_for_selector('#edit-bar:not([hidden])')
        a.click('#btn-add-item'); a.fill('#form-item [name=name]', 'Zavřít vodu'); a.fill('#form-item [name=cat]', 'Odjezd')
        a.click('#btn-item-save'); saved(a)
        a.click('#btn-edit-done')
        assert names(a) == ['Zavřít vodu']
        b.close()
    srv.shutdown()
    if errors:
        print('CHYBY:', errors); sys.exit(1)
    print('e2e: všechno prošlo')


if __name__ == '__main__':
    main()
