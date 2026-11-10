"""
Vytvoří náhledy obrazovek pro nápovědu (help/img/*.png) proti napodobenému Googlu
(tools/fakegoogle.py) s ukázkovými daty. Slouží zároveň jako rychlý smoke test.

    pip install playwright && playwright install chromium
    python tools/screenshots.py
"""
import functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from fakegoogle import FakeGoogle  # noqa: E402

OUT = os.path.join(ROOT, 'help', 'img')
PORT = 8082  # stejná adresa jako start.cmd, ať průvodce ukazuje správný origin
CLIENT = '123456789012-ukazka0example0abcdefghijkl.apps.googleusercontent.com'
KEY = 'AIzaSyUKAZKA0123456789abcdefghijklmnopq'
FIXED_NOW = '2026-11-10T09:00:00+01:00'
SAVED = "document.querySelector('#sync').textContent.includes('Uloženo')"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def main():
    os.makedirs(OUT, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://localhost:{PORT}/'
    g = FakeGoogle()

    with sync_playwright() as p:
        b = p.chromium.launch()

        def new(user='a', w=420, h=860, scheme='light'):
            ctx = b.new_context(viewport={'width': w, 'height': h}, locale='cs-CZ', timezone_id='Europe/Prague',
                                color_scheme=scheme, service_workers='block')
            pg = ctx.new_page()
            pg.clock.set_fixed_time(FIXED_NOW)
            g.install(pg)
            pg.add_init_script(f"window.__fakeUser = '{user}';")
            return ctx, pg

        def shot(pg, name, top=True, **kw):
            pg.mouse.move(1, 1)
            # bez oznámení, kurzoru v poli a posunu stránky – ať jsou snímky čisté
            pg.evaluate("(top) => { try { document.querySelector('#toast').hidePopover(); } catch {} "
                        "if (!document.querySelector('dialog[open]')) document.activeElement?.blur(); if (top) scrollTo(0, 0); }", top)
            pg.wait_for_timeout(250)
            pg.screenshot(path=os.path.join(OUT, name + '.png'), **kw)
            print('  ', name)

        def saved(pg):
            pg.wait_for_function(SAVED)

        def signed_in(pg):
            pg.goto(base)
            pg.evaluate(f"localStorage.setItem('odskrtnik.clientId','{CLIENT}'); localStorage.setItem('odskrtnik.apiKey','{KEY}')")
            pg.reload()
            pg.click('#btn-signin')
            pg.wait_for_selector('#view-lists:not([hidden])')

        def tick_all(pg):
            pg.evaluate("[...document.querySelectorAll('[data-toggle]')].map(t => t.dataset.toggle)"
                        ".forEach(id => document.querySelector(`[data-toggle='${id}']`).click())")
            saved(pg)

        def tick(pg, *names):
            for n in names:
                pg.click(f'.tick:has-text("{n}")')
            saved(pg)

        # --- Průvodce (počítač) ---
        ctx, pg = new(w=1000, h=820)
        pg.goto(base)
        pg.evaluate(f"localStorage.setItem('odskrtnik.clientId', '{CLIENT}')")
        pg.reload()
        shot(pg, 'pruvodce-uvod')
        for _ in range(2): pg.click('#setup-next')
        shot(pg, 'pruvodce-api')
        for _ in range(3): pg.click('#setup-next')
        pg.fill('#key-input', KEY)
        shot(pg, 'pruvodce-klic', full_page=True)
        ctx.close()

        # --- Telefon ---
        ctx, pg = new()
        signed_in(pg)
        pg.click('#btn-new-list')
        pg.click('[data-tpl="baleni"]')
        shot(pg, 'novy-seznam')
        pg.click('#btn-list-save')
        pg.wait_for_selector('#view-list:not([hidden])'); saved(pg)

        # Průchod „hory“, první zatržítka, uložit do historie a začít znovu
        pg.click('#btn-new-run')
        pg.click('[data-rtype="moře"]')
        pg.fill('#form-run [name=title]', 'Chorvatsko – červenec')
        pg.click('#form-run [type=submit]'); saved(pg)
        tick_all(pg)
        pg.click('#btn-new-run')
        pg.click('[data-rtype="moře"]'); pg.click('[data-rtype="hory"]')
        pg.fill('#form-run [name=title]', 'Krkonoše – leden')
        shot(pg, 'novy-pruchod')
        pg.click('#form-run [type=submit]'); saved(pg)
        tick(pg, 'Občanka / pas', 'Platební karta a hotovost', 'Cestovní pojištění', 'Spodní prádlo a ponožky', 'Trička', 'Pohorky')
        shot(pg, 'seznam')
        pg.check('#chk-hide')
        shot(pg, 'seznam-skryt')
        pg.uncheck('#chk-hide')

        # Úpravy
        pg.click('#btn-list-menu')
        shot(pg, 'menu')
        pg.click('#m-edit')
        pg.evaluate("scrollTo(0, document.querySelector('[data-cat=\"Oblečení\"]').getBoundingClientRect().top + scrollY - 70)")
        shot(pg, 'upravy', top=False)
        pg.click('[data-edit]:has-text("Čepice a rukavice")')
        pg.fill('#form-item [name=types]', 'hory, lyže')
        pg.dispatch_event('#form-item [name=types]', 'input')
        shot(pg, 'uprava-polozky')
        pg.click('#dlg-item [data-close]')
        pg.click('#btn-edit-done')

        # Historie a sdílení
        pg.click('#btn-list-menu'); pg.click('#m-history')
        pg.wait_for_selector('#history li:has-text("Chorvatsko")')
        shot(pg, 'historie')
        pg.click('#dlg-history [data-close]')
        pg.click('#btn-share')
        pg.fill('#form-share [name=email]', 'jana@example.com'); pg.click('#form-share [type=submit]')
        pg.wait_for_selector('#people li:has-text("Jana")')
        shot(pg, 'sdileni')
        link = pg.inner_text('#share-link')
        pg.click('#dlg-share [data-close]')

        # Druhý seznam: před vyplutím (napůl hotový), třetí: zazimování (hotový)
        pg.click('#btn-back')
        pg.click('#btn-new-list'); pg.click('#btn-list-save')
        pg.wait_for_selector('#view-list:not([hidden])'); saved(pg)
        tick(pg, 'Olej v motoru', 'Chladicí kapalina', 'Palivo', 'Řemen alternátoru', 'Po nastartování',
             'Průchodky a ventily', 'Stoka suchá', 'Záchranné vesty')
        shot(pg, 'vypluti')
        pg.click('#btn-back')
        pg.click('#btn-new-list'); pg.click('[data-tpl="zazimovani"]'); pg.click('#btn-list-save')
        pg.wait_for_selector('#view-list:not([hidden])'); saved(pg)
        tick_all(pg)
        pg.click('#btn-back')
        pg.wait_for_selector('.list-card:has-text("Zazimování")')
        shot(pg, 'seznamy')
        ctx.close()

        # --- Druhý uživatel: zpřístupnění sdíleného seznamu ---
        ctx, pg = new('b')
        signed_in(pg)
        pg.goto(link.replace(f'http://localhost:{PORT}/', base))
        pg.wait_for_selector('#view-grant:not([hidden])')
        shot(pg, 'zpristupneni')
        ctx.close()

        # --- Počítač, tmavý režim ---
        ctx, pg = new(w=1100, h=760, scheme='dark')
        signed_in(pg)
        pg.click('.list-card:has-text("Balení")')
        pg.wait_for_selector('#view-list:not([hidden])'); saved(pg)
        shot(pg, 'pocitac-tmavy')
        ctx.close()
        b.close()
    srv.shutdown()


if __name__ == '__main__':
    main()
