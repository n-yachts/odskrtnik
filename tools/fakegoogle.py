"""
Napodobenina Google API pro testy a náhledy (bez skutečného účtu).

Umí jen to, co Odškrtník používá: přihlášení (GIS), Drive v3 (soubory, sdílení, about),
Sheets v4 (hodnoty, append, batchUpdate) a Google Picker. Hlídá i pravidlo oprávnění
drive.file: uživatel vidí soubor, jen když ho vytvořil nebo ho „vybral“ v Pickeru.

Uživatel se volí v prohlížeči proměnnou window.__fakeUser ('a' nebo 'b'),
Picker vrátí soubor z window.__pickId.
"""
import json
import re
from urllib.parse import parse_qs, unquote, urlparse

USERS = {
    'a': {'displayName': 'Jan Novák', 'emailAddress': 'jan@example.com'},
    'b': {'displayName': 'Jana Nováková', 'emailAddress': 'jana@example.com'},
}

FAKE_GIS = """window.google = window.google || {}; window.google.accounts = {oauth2: {
  initTokenClient(c){ return { requestAccessToken(o){ setTimeout(() => c.callback({
    access_token: 'tok-' + (window.__fakeUser || 'a'), expires_in: 3600, scope: o.scope }), 30); } }; },
  hasGrantedAllScopes(){ return true; }, revoke(t, cb){ cb(); } }};"""

FAKE_GAPI = """window.gapi = { load(name, opts){ setTimeout(opts.callback, 10); } };
window.google = window.google || {};
window.google.picker = {
  ViewId: { SPREADSHEETS: 'spreadsheets' }, DocsViewMode: { LIST: 'list' },
  Feature: { MULTISELECT_ENABLED: 'multi' }, Action: { PICKED: 'picked', CANCEL: 'cancel' },
  DocsView: class { setMode(){return this;} setFileIds(){return this;} setQuery(){return this;} },
  PickerBuilder: class {
    addView(){return this;} enableFeature(){return this;} setOAuthToken(t){this.t=t;return this;}
    setDeveloperKey(){return this;} setAppId(){return this;} setLocale(){return this;} setTitle(){return this;}
    setCallback(cb){this.cb=cb;return this;}
    build(){ const self=this; return { setVisible(){ const id = window.__pickId;
      fetch('https://www.googleapis.com/fake/pick?id=' + encodeURIComponent(id || ''), {headers:{Authorization:'Bearer '+self.t}})
        .then(() => self.cb(id ? {action:'picked', docs:[{id}]} : {action:'cancel'})); } }; }
  } };"""


class FakeGoogle:
    def __init__(self):
        self.files = {}   # id -> {name, owner, appProperties, trashed, perms:[{id,email,role}], granted:set, sheets:{title:[rows]}}
        self.n = 0
        self.offline = set()   # uživatelé „bez signálu“ – jejich požadavky selžou jako bez sítě
        self.stale = None      # {fileId: kopie listů} = batchGet vrací starší stav (zpožděné čtení po zápisu)
        self.disabled = False  # True = „Google Drive API has not been used in project … or it is disabled“

    # ----- pomocné -----
    def user(self, req):
        h = req.headers.get('authorization', '')
        return h.replace('Bearer tok-', '') if h.startswith('Bearer tok-') else None

    def visible(self, f, u):
        return u in f['granted'] and not f['trashed']

    def file_json(self, fid, u):
        f = self.files[fid]
        owner = USERS[f['owner']]
        return {'id': fid, 'name': f['name'], 'ownedByMe': f['owner'] == u, 'shared': len(f['perms']) > 1,
                'modifiedTime': '2026-11-09T09:00:00Z', 'owners': [owner], 'appProperties': f['appProperties'],
                'trashed': f['trashed'], 'mimeType': f.get('mimeType', 'application/vnd.google-apps.spreadsheet'),
                'parents': f.get('parents', ['root-' + f['owner']])}

    @staticmethod
    def parse_range(r):
        m = re.match(r"^'?(.*?)'?!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$", r)
        title = m.group(1).replace("''", "'")
        start = int(m.group(3)) if m.group(3) else 1
        end = int(m.group(5)) if m.group(5) else None
        cols = (ord(m.group(4) or m.group(2)) - ord(m.group(2))) + 1
        return title, start, end, ord(m.group(2)) - ord('A'), cols

    def write(self, rows, start, c0, values):
        for k, vals in enumerate(values):
            while len(rows) < start + k: rows.append([])
            row = list(rows[start - 1 + k])
            while len(row) < c0: row.append('')
            row[c0:c0 + len(vals)] = vals
            rows[start - 1 + k] = row

    def get_values(self, f, rng):
        title, start, end, c0, ncol = self.parse_range(rng)
        rows = f['sheets'].get(title)
        if rows is None:
            return None
        sel = rows[start - 1:(end or len(rows))]
        return [r[c0:c0 + ncol] for r in sel]

    # ----- obsluha požadavků (Playwright route) -----
    def handle(self, route):
        req = route.request
        u = urlparse(req.url)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        path = unquote(u.path)
        me = self.user(req)

        def ok(d, status=200):
            route.fulfill(status=status, content_type='application/json', body=json.dumps(d, ensure_ascii=False))

        def err(status, msg):
            ok({'error': {'code': status, 'message': msg}}, status)

        if me in self.offline:
            return route.abort('internetdisconnected')
        if self.disabled:
            return route.fulfill(status=403, content_type='application/json', body=json.dumps({'error': {
                'code': 403, 'status': 'PERMISSION_DENIED',
                'message': 'Google Drive API has not been used in project 123456789012 before or it is disabled.',
                'errors': [{'reason': 'accessNotConfigured'}],
                'details': [{'reason': 'SERVICE_DISABLED'}]}}))
        body = json.loads(req.post_data) if req.post_data else {}
        if not me:
            return err(401, 'no auth')

        if path == '/fake/pick':                       # Picker: uživatel vybral soubor → přístup
            fid = q.get('id')
            if fid in self.files and any(p['email'] == USERS[me]['emailAddress'] for p in self.files[fid]['perms']):
                self.files[fid]['granted'].add(me)
            return ok({})

        if path == '/drive/v3/about':
            return ok({'user': USERS[me]})

        if path == '/drive/v3/files' and req.method == 'GET':
            want = 'folder' if "value='folder'" in q.get('q', '') else '1'
            fs = [self.file_json(i, me) for i, f in self.files.items()
                  if self.visible(f, me) and f['appProperties'].get('odskrtnik') == want]
            return ok({'files': sorted(fs, key=lambda x: x['name'])})
        if path == '/drive/v3/files' and req.method == 'POST':
            folder = body.get('mimeType') == 'application/vnd.google-apps.folder'
            if folder:
                fid = f'folder{sum(k.startswith("folder") for k in self.files) + 1}'
            else:
                self.n += 1
                fid = f'sheet{self.n}'
            self.files[fid] = {'name': body['name'], 'owner': me, 'appProperties': body.get('appProperties', {}),
                               'mimeType': body.get('mimeType'), 'parents': body.get('parents', ['root-' + me]),
                               'trashed': False, 'granted': {me}, 'sheets': {'List 1': []},
                               'perms': [{'id': 'p0', 'email': USERS[me]['emailAddress'], 'role': 'owner', 'user': me}]}
            return ok(self.file_json(fid, me))

        m = re.match(r'^/drive/v3/files/([^/]+)(/permissions(?:/([^/]+))?)?$', path)
        if m:
            fid = m.group(1)
            f = self.files.get(fid)
            if not f or not self.visible(f, me):
                return err(404, 'File not found')
            if m.group(2):
                if req.method == 'GET':
                    return ok({'permissions': [{'id': p['id'], 'type': 'user', 'role': p['role'], 'emailAddress': p['email'],
                                                'displayName': next((v['displayName'] for v in USERS.values() if v['emailAddress'] == p['email']), p['email'])}
                                               for p in f['perms']]})
                if req.method == 'POST':
                    f['perms'].append({'id': f'p{len(f["perms"])}', 'email': body['emailAddress'], 'role': body['role']})
                    return ok({'id': 'p'})
                if req.method == 'DELETE':
                    f['perms'] = [p for p in f['perms'] if p['id'] != m.group(3)]
                    return route.fulfill(status=204)
            if req.method == 'PATCH':
                if 'name' in body: f['name'] = body['name']
                if 'appProperties' in body: f['appProperties'] = {**f['appProperties'], **body['appProperties']}
                if 'addParents' in q:
                    if f['owner'] != me:
                        return err(403, 'Only the owner can move')
                    rm = q.get('removeParents', '').split(',')
                    f['parents'] = [x for x in f.get('parents', ['root-' + f['owner']]) if x not in rm] + [q['addParents']]
                if body.get('trashed'): f['trashed'] = True
                return ok(self.file_json(fid, me))
            return ok(self.file_json(fid, me))

        m = re.match(r'^/v4/spreadsheets/([^/:]+)(.*)$', path)
        if m:
            fid, rest = m.group(1), m.group(2)
            f = self.files.get(fid)
            if not f or not self.visible(f, me):
                return err(404, 'Requested entity was not found.')
            sheets = f['sheets']
            if rest == '':
                return ok({'sheets': [{'properties': {'sheetId': i, 'title': t}} for i, t in enumerate(sheets)]})
            if rest == ':batchUpdate':
                titles = list(sheets)
                for r in body['requests']:
                    if 'updateSheetProperties' in r:
                        p = r['updateSheetProperties']['properties']
                        old = titles[p['sheetId']]
                        f['sheets'] = {(p['title'] if k == old else k): v for k, v in sheets.items()}
                        sheets = f['sheets']; titles = list(sheets)
                    elif 'addSheet' in r:
                        sheets[r['addSheet']['properties']['title']] = []
                        titles = list(sheets)
                    elif 'insertDimension' in r:
                        rg = r['insertDimension']['range']
                        sheets[titles[rg['sheetId']]].insert(rg['startIndex'], [])
                    elif 'deleteDimension' in r:
                        rg = r['deleteDimension']['range']
                        rows = sheets[titles[rg['sheetId']]]
                        del rows[rg['startIndex']:rg['endIndex']]
                return ok({})
            if rest == '/values:batchUpdate':
                for d in body['data']:
                    title, start, _, c0, _ = self.parse_range(d['range'])
                    self.write(sheets[title], start, c0, d['values'])
                return ok({})
            if rest == '/values:batchGet':
                src = {'sheets': self.stale[fid]} if self.stale and fid in self.stale else f
                vals = self.get_values(src, q['ranges'])
                if vals is None:
                    return err(400, 'Unable to parse range: ' + q['ranges'])
                return ok({'valueRanges': [{'values': vals}]})
            mv = re.match(r'^/values/(.+?)(:append)?$', rest)
            if mv:
                rng = mv.group(1)
                title, start, end, *_ = self.parse_range(rng)
                if title not in sheets:
                    return err(400, f'Unable to parse range: {rng}')
                if mv.group(2):
                    sheets[title].extend(body['values'])
                    return ok({})
                if req.method == 'PUT':
                    _, _, _, c0, _ = self.parse_range(rng)
                    self.write(sheets[title], start, c0, body['values'])
                    return ok({})
                return ok({'values': self.get_values(f, rng) or []})
        return err(400, 'unhandled ' + path)

    def install(self, page):
        page.route('https://accounts.google.com/gsi/client', lambda r: r.fulfill(content_type='text/javascript', body=FAKE_GIS))
        page.route('https://apis.google.com/js/api.js', lambda r: r.fulfill(content_type='text/javascript', body=FAKE_GAPI))
        page.route('https://www.googleapis.com/**', self.handle)
        page.route('https://sheets.googleapis.com/**', self.handle)
