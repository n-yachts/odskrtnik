"""
Označí soubory číslem verze (?v=...), aby prohlížeč po nasazení načetl nové soubory
a nebral staré z mezipaměti. Spusťte před každým commitem, který mění aplikaci:

    python tools/stamp.py            # verze = aktuální datum a čas
    python tools/stamp.py 20261109-1500
"""
import datetime, glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ver = sys.argv[1] if len(sys.argv) > 1 else datetime.datetime.now().strftime('%Y%m%d-%H%M')


def sub(path, pattern, repl):
    with open(path, encoding='utf-8') as f:
        s = f.read()
    n = re.sub(pattern, repl, s)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(n)


for page in ('index.html', 'help.html'):
    sub(os.path.join(ROOT, page),
        r'((?:href|src)="(?:styles\.css|js/app\.js|help/img/[a-z0-9-]+\.png))(\?v=[^"]*)?"',
        r'\1?v=%s"' % ver)
for f in glob.glob(os.path.join(ROOT, 'js', '*.js')):
    sub(f, r"from '(\./[a-z]+\.js)(\?v=[^']*)?'", r"from '\1?v=%s'" % ver)
# Nová verze = nová mezipaměť service workeru (stará se smaže).
sub(os.path.join(ROOT, 'sw.js'), r"const VERSION = '[^']*';", "const VERSION = '%s';" % ver)
print('Verze', ver)
