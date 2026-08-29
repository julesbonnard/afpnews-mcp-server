export function generateNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
}

// Explicit https allowlist (MCP_ALLOWED_REDIRECT_URIS, see wrangler.toml) — closes the OAuth
// open-redirect hole. localhost/127.0.0.1 is handled separately as a pattern in isAllowedRedirectUri().
// `env` takes a plain object (not just process.env) so this also works from a Worker's `env` binding.
export function buildAllowedUris(env: Record<string, string | undefined> = process.env): string[] {
  const extra = env.MCP_ALLOWED_REDIRECT_URIS;
  if (!extra) return [];
  return extra.split(',').map(s => s.trim()).filter(Boolean);
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
