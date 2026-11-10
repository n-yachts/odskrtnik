// Přihlášení přes Google Identity Services (token model).
// Aplikace běží jen v prohlížeči: nepotřebuje server ani client secret.
// Přístupový token platí ~1 hodinu; obnovení proběhne kliknutím
// (Google si pamatuje udělený souhlas, takže okno se jen mihne).

export const SCOPES = [
  // Jen soubory, které aplikace sama vytvořila nebo které jí uživatel ukázal (Google Picker).
  'https://www.googleapis.com/auth/drive.file',
];

const TOKEN_KEY = 'odskrtnik.token';
let tokenClient = null;
let pending = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Nepodařilo se načíst knihovnu Google přihlášení. Jste online?'));
    document.head.appendChild(s);
  });
}

export async function initAuth(clientId) {
  await loadGis();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES.join(' '),
    include_granted_scopes: true,
    callback: (resp) => {
      const p = pending; pending = null;
      if (!p) return;
      if (resp.error) return p.reject(new Error(describeError(resp.error)));
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...p.scopes)) {
        return p.reject(new Error('Nebyla udělena všechna oprávnění. Při přihlášení povolte přístup k souborům Disku, které aplikace používá.'));
      }
      const token = {
        value: resp.access_token,
        scope: resp.scope || p.scopes.join(' '),
        expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
      };
      try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token)); } catch {}
      p.resolve(token.value);
    },
    error_callback: (err) => {
      const p = pending; pending = null;
      if (!p) return;
      p.reject(new Error(err?.type === 'popup_closed' ? 'Přihlašovací okno bylo zavřeno.'
        : err?.type === 'popup_failed_to_open' ? 'Prohlížeč zablokoval přihlašovací okno. Povolte vyskakovací okna pro tuto stránku.'
        : 'Přihlášení se nezdařilo.'));
    },
  });
}

function describeError(code) {
  switch (code) {
    case 'access_denied': return 'Přístup byl zamítnut. Jste přidaní jako testovací uživatel, nebo je aplikace publikovaná?';
    case 'invalid_client': return 'Neplatné Client ID. Zkontrolujte ho v nastavení.';
    default: return `Chyba přihlášení: ${code}`;
  }
}

function readToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.expiresAt - 60000 > Date.now()) return t;
  } catch {}
  return null;
}

export function getStoredToken() {
  return readToken()?.value || null;
}

/** Má platný token dané oprávnění? */
export function hasScope(scope) {
  const t = readToken();
  return !!t && (t.scope || '').split(' ').includes(scope);
}

/**
 * Musí se volat z kliknutí uživatele, jinak prohlížeč zablokuje okno.
 * extraScopes: případná oprávnění navíc k základním.
 */
export function signIn({ extraScopes = [], forceConsent = false } = {}) {
  if (!tokenClient) return Promise.reject(new Error('Přihlášení není inicializované.'));
  if (pending) pending.reject(new Error('Přerušeno novým přihlášením.'));
  const scopes = [...SCOPES, ...extraScopes];
  return new Promise((resolve, reject) => {
    pending = { resolve, reject, scopes };
    tokenClient.requestAccessToken({ prompt: forceConsent ? 'consent' : '', scope: scopes.join(' ') });
  });
}

export function clearToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

export function signOut() {
  const t = getStoredToken();
  clearToken();
  if (t && window.google?.accounts?.oauth2) {
    return new Promise(res => google.accounts.oauth2.revoke(t, () => res()));
  }
  return Promise.resolve();
}
