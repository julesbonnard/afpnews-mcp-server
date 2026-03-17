# Auth Refactor — Serveur OAuth2 AFP natif

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remplacer Authentik/Supabase par un serveur OAuth2 minimal embarqué dans le MCP server, où l'écran de login demande les credentials AFP de l'utilisateur.

**Architecture:** Le MCP server implémente lui-même les endpoints OAuth2 essentiels (authorize, token, register). La page `/oauth/authorize` affiche un formulaire AFP. Après validation, un auth code est émis puis échangé contre un JWE (JWT chiffré) contenant les credentials AFP. Le serveur déchiffre ce JWE à chaque requête `/mcp` pour retrouver les credentials de l'utilisateur.

**Tech Stack:** Express, jose (JWE/JWS), crypto (Node built-in), TypeScript. Aucune dépendance externe d'auth.

---

## Variables d'environnement après refactor

| Variable | Obligatoire | Description |
|---|---|---|
| `APICORE_API_KEY` | ✅ | Clé API AFP (niveau serveur) |
| `APICORE_BASE_URL` | non | URL de base AFP (optionnel) |
| `JWT_SECRET` | ✅ | Secret aléatoire ≥ 32 chars pour chiffrer les tokens |
| `MCP_SERVER_URL` | ✅ | URL publique du serveur (ex: https://news-mcp.jub.cool) |
| `MCP_TRANSPORT` | non | `http` (défaut dans Docker) |
| `PORT` | non | Port HTTP (défaut: 3000) |
| `MCP_SESSION_TTL` | non | TTL sessions en ms (défaut: 3600000) |

**Supprimées :** `AUTHENTIK_*`, `OIDC_*`, `APICORE_USERNAME`, `APICORE_PASSWORD`

---

## Task 1 : Supprimer l'ancien système OAuth2 Authentik

**Files:**
- Modify: `src/index.ts`

**Step 1 : Supprimer les imports et fonctions obsolètes**

Retirer de `src/index.ts` :
- La fonction `buildAuthentikUrls`
- L'import de `rateLimit` (sera réajouté plus tard)
- Les variables `authentikBaseUrl`, `authentikSlug`, `authentikClientId`, `oidcDiscoveryUrl`, `oidcClientId`
- Les routes `/.well-known/oauth-authorization-server` et `/oauth/register`
- La logique `createRemoteJWKSet` + `jwtVerify` dans `/mcp`

Garder : `SESSION_TTL_MS`, le cleanup des sessions, `/health`, la logique de création de session MCP.

**Step 2 : Ajouter la validation de JWT_SECRET et MCP_SERVER_URL**

```typescript
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}
const serverUrl = process.env.MCP_SERVER_URL?.replace(/\/$/, '');
if (!serverUrl) {
  throw new Error('MCP_SERVER_URL is required in HTTP mode');
}
```

**Step 3 : Simplifier la route `/mcp` — retourner 401 sans logique d'auth pour l'instant**

```typescript
app.all('/mcp', async (req, res) => {
  res.setHeader('WWW-Authenticate', 'Bearer');
  res.status(401).json({ error: 'Not implemented yet' });
});
```

**Step 4 : Build + vérifier que le serveur démarre**

```bash
pnpm run build
```
Attendu : aucune erreur TypeScript.

**Step 5 : Commit**

```bash
git add src/index.ts
git commit -m "refactor: remove Authentik OAuth2 system"
```

---

## Task 2 : Dériver la clé de chiffrement depuis JWT_SECRET

**Files:**
- Modify: `src/index.ts`

**Step 1 : Importer les modules crypto nécessaires**

```typescript
import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
```

**Step 2 : Dériver une clé AES-256 depuis JWT_SECRET**

Ajouter dans `startHttpServer()`, après la validation de `jwtSecret` :

```typescript
// Dérive une clé AES-256-GCM de 32 octets depuis le secret texte
const encryptionKey = createHash('sha256').update(jwtSecret).digest();
```

Cette clé sert à chiffrer et déchiffrer les tokens JWE. Elle est déterministe (même secret → même clé) et n'est jamais exposée.

**Step 3 : Ajouter deux fonctions helper en dehors de `startHttpServer`**

```typescript
async function encryptCredentials(
  key: Uint8Array,
  username: string,
  password: string,
): Promise<string> {
  return new EncryptJWT({ u: username, p: password })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .encrypt(key);
}

async function decryptCredentials(
  key: Uint8Array,
  token: string,
): Promise<{ username: string; password: string }> {
  const { payload } = await jwtDecrypt(token, key);
  const { u, p } = payload as { u: string; p: string };
  if (!u || !p) throw new Error('Invalid token payload');
  return { username: u, password: p };
}
```

**Step 4 : Build**

```bash
pnpm run build
```

**Step 5 : Commit**

```bash
git add src/index.ts
git commit -m "feat: add JWE encrypt/decrypt helpers for AFP credentials"
```

---

## Task 3 : Stocker et gérer les auth codes

**Files:**
- Modify: `src/index.ts`

Les auth codes sont des tokens éphémères (5 min) générés après login AFP réussi. Ils sont échangés une seule fois contre un JWE token.

**Step 1 : Ajouter le store des auth codes dans `startHttpServer()`**

```typescript
type AuthCode = {
  username: string;
  password: string;
  redirectUri: string;
  codeChallenge: string;   // PKCE
  expiresAt: number;
};
const authCodes = new Map<string, AuthCode>();

// Nettoyage des codes expirés toutes les minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of authCodes) {
    if (now > data.expiresAt) authCodes.delete(code);
  }
}, 60_000);
```

**Step 2 : Build**

```bash
pnpm run build
```

**Step 3 : Commit**

```bash
git add src/index.ts
git commit -m "feat: add auth code store with TTL cleanup"
```

---

## Task 4 : Endpoint GET /oauth/authorize — page de login AFP

**Files:**
- Modify: `src/index.ts`

C'est l'écran que Claude Web et Claude Code ouvrent dans le navigateur.

**Step 1 : Ajouter le middleware pour parser les query strings et form data**

```typescript
app.use(express.urlencoded({ extended: false }));
```

**Step 2 : Ajouter la route GET /oauth/authorize**

```typescript
app.get('/oauth/authorize', (req, res) => {
  const { redirect_uri, code_challenge, state, client_id } = req.query as Record<string, string>;

  if (!redirect_uri || !code_challenge) {
    res.status(400).send('Missing required OAuth2 parameters');
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(buildLoginPage({ redirectUri: redirect_uri, codeChallenge: code_challenge, state, clientId: client_id }));
});
```

**Step 3 : Créer la fonction `buildLoginPage` (en dehors de `startHttpServer`)**

```typescript
function buildLoginPage(params: {
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  clientId?: string;
}): string {
  const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AFP News MCP — Connexion</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f4f4f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,.08);
      padding: 2.5rem;
      width: 100%;
      max-width: 420px;
    }
    .logo { font-size: 1.5rem; font-weight: 700; color: #111; margin-bottom: .25rem; }
    .subtitle { color: #6b7280; font-size: .9rem; margin-bottom: 2rem; }
    label { display: block; font-size: .875rem; font-weight: 500; color: #374151; margin-bottom: .375rem; }
    input {
      width: 100%; padding: .625rem .875rem;
      border: 1px solid #d1d5db; border-radius: 8px;
      font-size: 1rem; outline: none; margin-bottom: 1rem;
      transition: border-color .15s;
    }
    input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
    button {
      width: 100%; padding: .75rem;
      background: #2563eb; color: white;
      border: none; border-radius: 8px;
      font-size: 1rem; font-weight: 600;
      cursor: pointer; transition: background .15s;
    }
    button:hover { background: #1d4ed8; }
    button:disabled { background: #93c5fd; cursor: not-allowed; }
    .error {
      color: #dc2626; font-size: .875rem;
      margin-bottom: 1rem; display: none;
      background: #fef2f2; border: 1px solid #fecaca;
      padding: .625rem .875rem; border-radius: 8px;
    }
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
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn');
      const err = document.getElementById('err');
      btn.disabled = true;
      btn.textContent = 'Connexion…';
      err.style.display = 'none';
      try {
        const res = await fetch('/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'afp_credentials',
            username: document.getElementById('username').value,
            password: document.getElementById('password').value,
            redirect_uri: ${JSON.stringify(params.redirectUri)},
            code_challenge: ${JSON.stringify(params.codeChallenge)},
            state: ${JSON.stringify(params.state ?? '')},
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error_description || 'Identifiants invalides');
        }
        const { code } = await res.json();
        const url = new URL(${JSON.stringify(params.redirectUri)});
        url.searchParams.set('code', code);
        if (${JSON.stringify(params.state ?? '')}) url.searchParams.set('state', ${JSON.stringify(params.state ?? '')});
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
```

**Step 4 : Build**

```bash
pnpm run build
```

**Step 5 : Commit**

```bash
git add src/index.ts
git commit -m "feat: add OAuth2 authorize endpoint with AFP login page"
```

---

## Task 5 : Endpoint POST /oauth/token — échange code contre JWE + validation AFP

**Files:**
- Modify: `src/index.ts`

Cet endpoint gère deux cas :
1. `grant_type: afp_credentials` — appelé par la page de login pour valider les credentials AFP et générer un auth code
2. `grant_type: authorization_code` — appelé par le client OAuth2 (Claude) pour échanger l'auth code contre un JWE token

**Step 1 : Ajouter la route POST /oauth/token avec rate limiting**

```typescript
import rateLimit from 'express-rate-limit';

const tokenLimiter = rateLimit({ windowMs: 60_000, max: 10 });

app.post('/oauth/token', tokenLimiter, express.json(), async (req, res) => {
  const body = req.body as Record<string, string>;
  const grantType = body.grant_type;

  // --- Grant: validation AFP credentials depuis la page de login ---
  if (grantType === 'afp_credentials') {
    const { username, password, redirect_uri, code_challenge, state } = body;

    if (!username || !password || !redirect_uri || !code_challenge) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Missing required fields' });
      return;
    }

    // Valider les credentials contre l'API AFP
    try {
      const { ApiCore } = await import('afpnews-api');
      const testClient = new ApiCore({ ...(afpBaseUrl ? { baseUrl: afpBaseUrl } : {}), apiKey });
      await testClient.authenticate({ username, password });
    } catch {
      res.status(401).json({ error: 'invalid_grant', error_description: 'Identifiants AFP invalides' });
      return;
    }

    const code = crypto.randomUUID();
    authCodes.set(code, {
      username,
      password,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    res.json({ code });
    return;
  }

  // --- Grant: authorization_code (échange code → JWE token) ---
  if (grantType === 'authorization_code') {
    const { code, code_verifier, redirect_uri } = body;

    if (!code || !code_verifier || !redirect_uri) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Missing code, code_verifier or redirect_uri' });
      return;
    }

    const stored = authCodes.get(code);
    if (!stored || Date.now() > stored.expiresAt) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Auth code expired or not found' });
      return;
    }

    // Valider PKCE: SHA-256(code_verifier) doit correspondre au code_challenge stocké
    const { createHash } = await import('node:crypto');
    const expectedChallenge = createHash('sha256')
      .update(code_verifier)
      .digest('base64url');

    if (expectedChallenge !== stored.codeChallenge) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
      return;
    }

    if (stored.redirectUri !== redirect_uri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      return;
    }

    // Code à usage unique
    authCodes.delete(code);

    const accessToken = await encryptCredentials(encryptionKey, stored.username, stored.password);
    const refreshToken = await encryptCredentials(encryptionKey, stored.username, stored.password);

    res.json({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 30 * 24 * 3600, // 30 jours
      refresh_token: refreshToken,
    });
    return;
  }

  // --- Grant: refresh_token ---
  if (grantType === 'refresh_token') {
    const { refresh_token } = body;
    if (!refresh_token) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Missing refresh_token' });
      return;
    }

    try {
      const { username, password } = await decryptCredentials(encryptionKey, refresh_token);
      const accessToken = await encryptCredentials(encryptionKey, username, password);
      res.json({
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 30 * 24 * 3600,
        refresh_token,
      });
    } catch {
      res.status(401).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
    }
    return;
  }

  res.status(400).json({ error: 'unsupported_grant_type' });
});
```

**Step 2 : Build**

```bash
pnpm run build
```

**Step 3 : Commit**

```bash
git add src/index.ts
git commit -m "feat: add OAuth2 token endpoint with AFP credentials validation and PKCE"
```

---

## Task 6 : Endpoint GET /.well-known/oauth-authorization-server + DCR shim

**Files:**
- Modify: `src/index.ts`

**Step 1 : Ajouter les endpoints OAuth2 discovery et DCR**

```typescript
app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json({
    issuer: serverUrl,
    authorization_endpoint: `${serverUrl}/oauth/authorize`,
    token_endpoint: `${serverUrl}/oauth/token`,
    registration_endpoint: `${serverUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
});

const registerLimiter = rateLimit({ windowMs: 60_000, max: 20 });
app.post('/oauth/register', registerLimiter, express.json(), (req, res) => {
  const body = req.body as { redirect_uris?: string[] } | undefined;
  // Le client_id est l'URL du serveur — pas de secret, flux PKCE uniquement
  res.status(201).json({
    client_id: serverUrl,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: body?.redirect_uris ?? [],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
});
```

Note : le `client_id` est maintenant l'URL du serveur lui-même — c'est une convention MCP valide et évite d'avoir à gérer un identifiant supplémentaire.

**Step 2 : Build**

```bash
pnpm run build
```

**Step 3 : Commit**

```bash
git add src/index.ts
git commit -m "feat: add OAuth2 discovery metadata and DCR shim"
```

---

## Task 7 : Mettre à jour /mcp pour utiliser les JWE tokens

**Files:**
- Modify: `src/index.ts`

**Step 1 : Remplacer le placeholder dans la route /mcp**

```typescript
app.all('/mcp', async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ error: 'Bearer token required' });
    return;
  }

  const token = authHeader.slice(7);
  let username: string;
  let password: string;

  try {
    ({ username, password } = await decryptCredentials(encryptionKey, token));
  } catch {
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastAccessedAt = Date.now();
    await session.transport.handleRequest(req, res);
    return;
  }

  if (sessionId) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  const server = await createServer({ apiKey, username, password, baseUrl: afpBaseUrl });
  await server.connect(transport);

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      sessions.delete(sid);
      console.error(`Session ${sid} closed`);
    }
  };

  await transport.handleRequest(req, res);

  const sid = transport.sessionId;
  if (sid) {
    sessions.set(sid, { transport, server, lastAccessedAt: Date.now() });
    console.error(`Session ${sid} created (user: ${username})`);
  }
});
```

Note : `username` est loggé (pas `password`) pour la traçabilité.

**Step 2 : Build**

```bash
pnpm run build
```

**Step 3 : Test manuel**

```bash
# Démarrer le serveur localement
MCP_TRANSPORT=http JWT_SECRET=testsecretatleast32charslong1234 \
  MCP_SERVER_URL=http://localhost:3000 \
  APICORE_API_KEY=<key> node build/index.js

# Vérifier le discovery
curl http://localhost:3000/.well-known/oauth-authorization-server | jq

# Vérifier la page de login
open http://localhost:3000/oauth/authorize?redirect_uri=http://localhost:9999/cb&code_challenge=abc&response_type=code&client_id=test
```

**Step 4 : Commit**

```bash
git add src/index.ts
git commit -m "feat: update /mcp to validate JWE tokens and extract per-user AFP credentials"
```

---

## Task 8 : Supprimer les variables d'env obsolètes de server.ts

**Files:**
- Modify: `src/server.ts`

Vérifier que `createServer` ne valide pas obligatoirement `username` et `password` vides — ils sont maintenant fournis par le token, jamais vides en pratique. La validation actuelle dans `server.ts` est correcte (elle lève si vides), donc pas de changement nécessaire.

**Vérifier seulement :**

```bash
grep -n "APICORE_USERNAME\|APICORE_PASSWORD" src/
```

Attendu : ces variables ne doivent plus apparaître dans `src/index.ts`. Si présent, supprimer.

---

## Task 9 : Mettre à jour le Dockerfile et la documentation des env vars

**Files:**
- Modify: `Dockerfile`

**Step 1 : Supprimer la variable d'env inutile du Dockerfile**

Le Dockerfile ne doit plus avoir de variables d'env liées à l'auth AFP. Vérifier que seul `MCP_TRANSPORT=http` est setté (les autres viennent de Coolify).

**Step 2 : Créer `.env.example` à la racine**

```bash
# AFP API
APICORE_API_KEY=your-afp-api-key
APICORE_BASE_URL=                    # optionnel

# Auth
JWT_SECRET=<random-string-min-32-chars>   # générer avec: openssl rand -base64 32

# Serveur
MCP_SERVER_URL=https://news-mcp.example.com
PORT=3000                            # optionnel
MCP_TRANSPORT=http                   # stdio ou http
MCP_SESSION_TTL=3600000              # optionnel, ms
```

**Step 3 : Build final**

```bash
pnpm run build
```

**Step 4 : Commit final**

```bash
git add Dockerfile .env.example src/
git commit -m "chore: update env vars, remove Authentik dependencies"
git push origin main
```

---

## Récapitulatif des endpoints après refactor

| Endpoint | Méthode | Auth | Description |
|---|---|---|---|
| `/health` | GET | non | Health check Coolify |
| `/.well-known/oauth-authorization-server` | GET | non | Discovery OAuth2 |
| `/oauth/register` | POST | non | DCR shim (rate limited) |
| `/oauth/authorize` | GET | non | Page de login AFP |
| `/oauth/token` | POST | non | Échange code → JWE token (rate limited) |
| `/mcp` | ALL | Bearer JWE | Point d'entrée MCP |

## Config Claude Code après déploiement

```bash
claude mcp add --transport http https://news-mcp.jub.cool/mcp
```

Claude Code ouvre `https://news-mcp.jub.cool/oauth/authorize` dans le navigateur → l'utilisateur entre ses credentials AFP → token généré → stocké par Claude Code automatiquement.

## Config Coolify après refactor

Variables d'env à configurer :
```
APICORE_API_KEY=...
JWT_SECRET=<openssl rand -base64 32>
MCP_SERVER_URL=https://news-mcp.jub.cool
```

Variables à **supprimer** de Coolify :
- `AUTHENTIK_BASE_URL`
- `AUTHENTIK_APP_SLUG`
- `AUTHENTIK_CLIENT_ID`
- `AUTHENTIK_CLIENT_SECRET` (si présent)
- `APICORE_USERNAME`
- `APICORE_PASSWORD`
