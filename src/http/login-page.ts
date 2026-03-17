// Security fix #1: XSS — use JSON.stringify for all JS-embedded values
// Security fix #6: CSP + X-Frame-Options headers added in the route handler
export function buildLoginPage(params: {
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  clientId?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AFP News MCP — Connexion</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f4f4f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .card { background: white; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.08); padding: 2.5rem; width: 100%; max-width: 420px; }
    .logo { font-size: 1.5rem; font-weight: 700; color: #111; margin-bottom: .25rem; }
    .subtitle { color: #6b7280; font-size: .9rem; margin-bottom: 2rem; }
    label { display: block; font-size: .875rem; font-weight: 500; color: #374151; margin-bottom: .375rem; }
    input { width: 100%; padding: .625rem .875rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 1rem; outline: none; margin-bottom: 1rem; transition: border-color .15s; }
    input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
    button { width: 100%; padding: .75rem; background: #2563eb; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background .15s; }
    button:hover { background: #1d4ed8; }
    button:disabled { background: #93c5fd; cursor: not-allowed; }
    .error { color: #dc2626; font-size: .875rem; margin-bottom: 1rem; display: none; background: #fef2f2; border: 1px solid #fecaca; padding: .625rem .875rem; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">AFP News MCP</div>
    <div class="subtitle">Connectez-vous avec vos identifiants AFP</div>
    <div class="error" id="err"></div>
    <form id="form">
      <label for="username">Identifiant AFP</label>
      <input id="username" name="username" type="text" autocomplete="username" required>
      <label for="password">Mot de passe</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit" id="btn">Se connecter</button>
    </form>
  </div>
  <script>
    const REDIRECT_URI = ${JSON.stringify(params.redirectUri)};
    const CODE_CHALLENGE = ${JSON.stringify(params.codeChallenge)};
    const STATE = ${JSON.stringify(params.state ?? '')};
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn');
      const err = document.getElementById('err');
      btn.disabled = true;
      btn.textContent = 'Connexion\u2026';
      err.style.display = 'none';
      try {
        const res = await fetch('/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'afp_credentials',
            username: document.getElementById('username').value,
            password: document.getElementById('password').value,
            redirect_uri: REDIRECT_URI,
            code_challenge: CODE_CHALLENGE,
            state: STATE,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error_description || 'Identifiants invalides');
        }
        const { code } = await res.json();
        const url = new URL(REDIRECT_URI);
        url.searchParams.set('code', code);
        if (STATE) url.searchParams.set('state', STATE);
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        window.location.href = url.toString();
      } catch (e) {
        err.textContent = e.message;
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Se connecter';
      }
    });
  </script>
</body>
</html>`;
}

// Security fix #2/#7: strict redirect_uri whitelist
// - localhost/127.0.0.1 (any port): Claude Code local OAuth server
// - explicit https URIs: Claude Web + MCP_ALLOWED_REDIRECT_URIS env var
const BUILTIN_ALLOWED_URIS = ['https://claude.ai/api/mcp/auth_callback'];

export function buildAllowedUris(): string[] {
  const extra = process.env.MCP_ALLOWED_REDIRECT_URIS;
  if (!extra) return BUILTIN_ALLOWED_URIS;
  return [...BUILTIN_ALLOWED_URIS, ...extra.split(',').map(s => s.trim()).filter(Boolean)];
}

export function isAllowedRedirectUri(uri: string, allowedUris: string[]): boolean {
  try {
    const url = new URL(uri);
    // Claude Code uses a local HTTP server on a random port
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return true;
    }
    // Explicit https whitelist (exact match)
    return allowedUris.includes(uri);
  } catch {
    return false;
  }
}
