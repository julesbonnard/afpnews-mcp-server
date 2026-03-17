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

### Framework HTTP : Elysia + `@elysiajs/node`

Elysia remplace Express. L'adaptateur `@elysiajs/node` est requis car `StreamableHTTPServerTransport.handleRequest(req, res)` du SDK MCP attend des objets Node.js `IncomingMessage`/`ServerResponse`. Bun étant Node.js-compatible, cet adaptateur fonctionne sans friction.

Les routes OAuth bénéficient du typage automatique du body via `t.Object()` (TypeBox intégré à Elysia), éliminant tous les `as Record<string, string>` du code actuel.

### Build npm : tsc conservé

`tsc` reste l'outil de build pour la publication npm — il est le seul à générer les fichiers `.d.ts` nécessaires aux consommateurs TypeScript (projet Vue.js/Vite). Son rôle passe de "compilateur runtime" à "compilateur npm uniquement".

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
| `@elysiajs/node` | adaptateur Node.js pour compatibilité MCP transport |
| `@elysiajs/rate-limit` | rate limiting natif Elysia |

### Inchangées

`@modelcontextprotocol/sdk`, `afpnews-api`, `jose`, `zod`, `typescript`

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

---

## Dockerfile

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ ./src/
COPY tsconfig.json ./
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
```

Avantages : pas de step `tsc`, image plus légère, démarrage plus rapide.

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

Le handler `/mcp` accède aux objets Node.js req/res via l'adaptateur `@elysiajs/node` pour passer à `transport.handleRequest(req, res)`.

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
| `src/index.ts` | Réécriture du serveur HTTP (Express → Elysia) |
| `package.json` | Dépendances + scripts + packageManager |
| `Dockerfile` | FROM oven/bun, suppression tsc build step |
| `src/__tests__/*.test.ts` | Migration vitest → bun test (syntaxe quasi-identique) |
| `pnpm-lock.yaml` | Supprimé → `bun.lock` |
| `.gitignore` / `.dockerignore` | Ajout `bun.lock` si absent |

---

## Risques

| Risque | Probabilité | Mitigation |
|---|---|---|
| `@elysiajs/node` incompatible avec `StreamableHTTPServerTransport` | Faible | Tester en premier, fallback possible vers Express pour `/mcp` uniquement |
| `afpnews-api` incompatible avec Bun | Très faible | Bun est Node.js-compatible, le package utilise des APIs standard |
| `bun test` incompatible avec les tests existants (vitest) | Faible | Syntaxe Jest-compatible, ajustements mineurs attendus |
