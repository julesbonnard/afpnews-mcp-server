# Migration Bun + Elysia — Design Spec

**Date :** 2026-03-17
**Projet :** afpnews-mcp-server
**Statut :** approuvé

---

## Contexte

Le serveur MCP AFP est actuellement écrit en TypeScript, compilé via `tsc`, et s'exécute sur Node.js avec Express comme framework HTTP. L'objectif de cette migration est d'adopter Bun comme runtime et Elysia comme framework HTTP afin d'améliorer la qualité du code (typage du body des routes OAuth) et de simplifier le tooling (suppression de dotenv, vitest, Express).

### Contraintes

- Le package est publié sur npm : l'export `afpnews-mcp-server/definitions` doit rester compatible Node.js/Vite (utilisé dans un projet Vue.js).
- Le serveur est déployé via Docker sur Coolify (mode HTTP) et utilisé localement avec Bun (mode stdio).
- Aucune compatibilité Node.js n'est requise pour le runtime du serveur lui-même.

---

## Décisions d'architecture

### Runtime : Bun

Bun remplace Node.js comme runtime pour tous les contextes d'exécution :
- Dev local : `bun run src/index.ts` (TS natif, pas de compilation)
- Docker/Coolify : `FROM oven/bun`, `bun run src/index.ts`
- stdio (Claude Code local) : `bun run src/index.ts`

**Guard d'entrée :** Le guard `if (import.meta.url === \`file://${process.argv[1]}\`)` de Node.js ne fonctionne pas fiablement sous Bun. Il doit être remplacé par :

```typescript
if (import.meta.main) {
  main().catch(...)
}
```

### Framework HTTP : Elysia + `@elysiajs/node`

Elysia remplace Express. L'adaptateur `@elysiajs/node` est requis pour deux raisons :

1. **Compatibilité MCP transport** : `StreamableHTTPServerTransport.handleRequest(req, res)` attend des objets Node.js `IncomingMessage`/`ServerResponse`. L'adaptateur `@elysiajs/node` expose ces objets via `context.node.req` / `context.node.res` dans les handlers Elysia.

2. **Bun est Node.js-compatible** : `@elysiajs/node` fonctionne sur Bun sans friction.

Les routes OAuth bénéficient du typage automatique du body via `t.Object()` (TypeBox intégré à Elysia), éliminant tous les `as Record<string, string>` du code actuel.

### Build npm : tsc conservé

`tsc` reste l'outil de build pour la publication npm — il est le seul à générer les fichiers `.d.ts` nécessaires aux consommateurs TypeScript (projet Vue.js/Vite). Son rôle passe de "compilateur runtime" à "compilateur npm uniquement".

`@types/node` reste en devDependencies : `tsc` en a besoin pour type-checker les imports `node:crypto` (`hkdfSync`, `createHash`) qui subsistent dans `src/index.ts`.

---

## Dépendances

### Supprimées

| Package | Raison |
|---|---|
| `dotenv` | Bun charge `.env` nativement |
| `express` | remplacé par Elysia |
| `express-rate-limit` | remplacé par `@elysiajs/rate-limit` |
| `@types/express` | plus nécessaire |
| `vitest` | remplacé par `bun test` |

### Ajoutées

| Package | Raison |
|---|---|
| `elysia` | framework HTTP principal |
| `@elysiajs/node` | adaptateur Node.js — expose `node.req`/`node.res` pour le MCP transport |
| `@elysiajs/rate-limit` | rate limiting natif Elysia |

### Inchangées

`@modelcontextprotocol/sdk`, `afpnews-api`, `jose`, `zod`, `typescript`, `@types/node`

---

## Tooling

| Commande | Avant | Après |
|---|---|---|
| Install | `pnpm install` | `bun install` |
| Dev | `tsc && node build/index.js` | `bun run src/index.ts` |
| Build npm | `tsc` | `tsc` (inchangé) |
| Tests | `vitest run` | `bun test` |
| Start (prod) | `node build/index.js` | `bun run build/index.js` |

`pnpm-lock.yaml` est remplacé par `bun.lock`. Le `packageManager` dans `package.json` passe de `pnpm@10.x` à `bun`.

`vitest.config.ts` est supprimé. Si une configuration de test est nécessaire (patterns, timeout), elle est définie dans `bunfig.toml` sous `[test]`.

---

## Dockerfile

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ ./src/
COPY tsconfig.json ./
USER bun
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
```

L'image `oven/bun:1` inclut un utilisateur non-root `bun` — `USER bun` doit être conservé (équivalent de la hardening `appuser` du Dockerfile actuel). Pas de step `tsc` → démarrage plus rapide, image plus légère.

---

## Architecture HTTP (Elysia)

Le fichier `src/index.ts` est le seul fichier réécrit significativement. La structure Elysia remplace Express :

```typescript
// Avant (Express)
app.post('/oauth/token', tokenLimiter, express.json({ limit: '10kb' }), async (req, res) => {
  const body = req.body as Record<string, string>; // cast manuel non typé
  ...
});

// Après (Elysia)
app.post('/oauth/token', ({ body, set }) => {
  // body entièrement typé via t.Object() — zero cast
  const { grant_type, username, password } = body;
  ...
}, {
  body: t.Object({
    grant_type: t.String(),
    username: t.Optional(t.String()),
    password: t.Optional(t.String()),
    ...
  })
});
```

La logique métier (PKCE, JWE, sessions Map, TTL cleanup, OAuth flow complet) est inchangée — seul le glue HTTP est réécrit.

### Gestion du endpoint `/mcp`

Le transport MCP (Streamable HTTP) requiert `GET`, `POST` et `DELETE` sur `/mcp` (initialisation, streaming SSE, teardown de session). Elysia n'a pas d'équivalent direct à `app.all()` — les trois verbes sont enregistrés séparément :

```typescript
const mcpHandler = async ({ node: { req, res } }: { node: { req: IncomingMessage; res: ServerResponse } }) => {
  // authentification Bearer + gestion de session identique à l'actuel
  await transport.handleRequest(req, res);
};

app
  .get('/mcp', mcpHandler)
  .post('/mcp', mcpHandler)
  .delete('/mcp', mcpHandler)
```

L'accès aux objets Node.js se fait via `context.node.req` / `context.node.res` fournis par `@elysiajs/node`.

### Rate limiting et trust proxy

`@elysiajs/rate-limit` doit être configuré pour honorer `X-Forwarded-For` / `X-Real-IP` derrière Traefik sur Coolify (équivalent de `app.set('trust proxy', 1)` dans Express). La configuration explicite du `generator` de clé IP est requise :

```typescript
import { rateLimit } from '@elysiajs/rate-limit'

app.use(rateLimit({
  max: 10,
  duration: 60_000,
  generator: (req) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
}))
```

---

## Migration des tests (vitest → bun test)

La syntaxe `describe`/`it`/`expect` est compatible. Les points nécessitant une attention particulière :

- **`vi.fn()` / `vi.spyOn()`** → `mock()` / `spyOn()` de `bun:test`
- **`vi.mock()`** → `mock.module()` de `bun:test`
- **`vi.hoisted()`** → **pas d'équivalent direct**. Les tests utilisant `vi.hoisted()` (notamment `create-server.test.ts`) doivent être restructurés : déplacer la déclaration des mocks avant les imports, ou utiliser `mock.module()` avec une factory. C'est la modification la plus substantielle des tests — prévoir ~2h de travail.

---

## Périmètre — Ce qui ne change pas

- `src/server.ts`, `src/definitions.ts`
- `src/tools/`, `src/prompts/`, `src/resources/`, `src/utils/`
- Export npm `afpnews-mcp-server/definitions` — compatible Node.js/Vite
- `tsconfig.json` — ajustement mineur possible (cible ES2022/Node16 conservée)
- Toute la logique métier de `src/index.ts`

---

## Fichiers modifiés

| Fichier | Nature du changement |
|---|---|
| `src/index.ts` | Réécriture du serveur HTTP (Express → Elysia) + `import.meta.main` |
| `package.json` | Dépendances + scripts + packageManager |
| `Dockerfile` | FROM oven/bun, USER bun, suppression tsc build step |
| `src/__tests__/*.test.ts` | Migration vitest → bun test ; `vi.hoisted()` à restructurer |
| `pnpm-lock.yaml` | Supprimé → `bun.lock` |
| `vitest.config.ts` | Supprimé |
| `.gitignore` / `.dockerignore` | Ajout `bun.lock`, suppression mentions pnpm si présentes |
| `bunfig.toml` | Créé si configuration de test nécessaire |

---

## Risques

| Risque | Probabilité | Mitigation |
|---|---|---|
| `context.node.req`/`res` insuffisant pour `StreamableHTTPServerTransport` (body déjà consommé, etc.) | Faible | Valider en premier (smoke test `/mcp` POST) avant de migrer les routes OAuth ; fallback : garder Express uniquement pour `/mcp` |
| `@elysiajs/rate-limit` sans trust proxy → rate limiting inefficace derrière Traefik | Faible si configuré | Configurer le `generator` IP explicitement (voir section Architecture HTTP) |
| `afpnews-api` incompatible avec Bun | Très faible | Bun est Node.js-compatible, le package utilise des APIs standard |
| `vi.hoisted()` dans les tests — réécriture non triviale | Certain | Prévoir du temps dédié (~2h) ; les tests fonctionnent après restructuration |
