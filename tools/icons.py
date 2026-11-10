"""
Vytvoří ikony aplikace do icons/ (deska se zaškrtávacím seznamem).

    pip install pillow
    python tools/icons.py

icon-192/512.png  – běžné ikony (zaoblený čtverec)
maskable-512.png  – ikona pro Android (celoplošné pozadí, motiv v bezpečné zóně)
apple-touch-icon.png (180 px), favicon-32.png
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
BG = (31, 95, 139)        # námořní modrá Odškrtníku
WHITE = (255, 255, 255)
DARK = (14, 42, 64)
GREEN = (47, 160, 96)
LIGHT = (214, 222, 230)
LINE = (160, 175, 190)
SS = 4                    # převzorkování kvůli hladkým hranám


def draw_icon(size, maskable=False, rounded=True):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or not rounded:
        d.rectangle([0, 0, S, S], fill=BG)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)

    # Motiv kreslíme v souřadnicích 0–1; u maskable ikony ho zmenšíme do bezpečné zóny (80 %).
    scale = 0.9 if maskable else 1.0
    off = (1 - scale) / 2

    def P(x, y):
        return (int((off + x * scale) * S), int((off + y * scale) * S))

    def R(x0, y0, x1, y1, r, fill):
        a, b = P(x0, y0), P(x1, y1)
        d.rounded_rectangle([a, b], radius=int(r * scale * S), fill=fill)

    def C(x, y, r, fill):
        cx, cy = P(x, y)
        rr = int(r * scale * S)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=fill)

    # Deska s klipem a třemi řádky; první dva odškrtnuté.
    R(0.24, 0.20, 0.76, 0.86, 0.06, WHITE)                 # deska
    R(0.38, 0.14, 0.62, 0.25, 0.035, DARK)                 # klip
    w = int(0.045 * scale * S)
    for k, y in enumerate((0.38, 0.55, 0.72)):
        R(0.31, y - 0.055, 0.42, y + 0.055, 0.02, GREEN if k < 2 else LIGHT)   # políčko
        if k < 2:
            d.line([P(0.335, y), P(0.36, y + 0.03), P(0.40, y - 0.035)], fill=WHITE, width=int(w * 0.55), joint='curve')
        R(0.47, y - 0.02, 0.69 if k != 1 else 0.63, y + 0.02, 0.02, LINE)    # text řádku
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    draw_icon(192).save(os.path.join(OUT, 'icon-192.png'))
    draw_icon(512).save(os.path.join(OUT, 'icon-512.png'))
    draw_icon(512, maskable=True).save(os.path.join(OUT, 'maskable-512.png'))
    draw_icon(180, rounded=False).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
    draw_icon(32).save(os.path.join(OUT, 'favicon-32.png'))
    print('Ikony uloženy do', OUT)


if __name__ == '__main__':
    main()
