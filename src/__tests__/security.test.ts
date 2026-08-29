import { describe, expect, it } from 'bun:test';
import { buildAllowedUris, isAllowedRedirectUri, generateNonce } from '../http/security.js';

describe('generateNonce', () => {
  it('returns a fresh, non-empty value each call', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('buildAllowedUris', () => {
  it('returns an empty array when the env var is unset', () => {
    expect(buildAllowedUris({})).toEqual([]);
  });

  it('splits, trims and drops empty entries', () => {
    expect(buildAllowedUris({ MCP_ALLOWED_REDIRECT_URIS: ' https://a.example.com , https://b.example.com,,' })).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });
});

describe('isAllowedRedirectUri', () => {
  it('allows any localhost URI regardless of port, ignoring the whitelist', () => {
    expect(isAllowedRedirectUri('http://localhost:54321/callback', [])).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:9999/callback', [])).toBe(true);
  });

  it('rejects an https localhost URI (only http: qualifies for the local-client bypass)', () => {
    expect(isAllowedRedirectUri('https://localhost:54321/callback', [])).toBe(false);
  });

  it('allows an exact match against the whitelist', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback', ['https://claude.ai/api/mcp/auth_callback'])).toBe(true);
  });

  it('rejects a URI not in the whitelist', () => {
    expect(isAllowedRedirectUri('https://evil.example.com/callback', ['https://claude.ai/api/mcp/auth_callback'])).toBe(false);
  });

  it('rejects an unparseable URI instead of throwing', () => {
    expect(isAllowedRedirectUri('not a url', [])).toBe(false);
  });
});
