import { describe, expect, it } from 'bun:test';
import {
  deriveKey,
  sha256Base64Url,
  encryptAfpToken,
  decryptAfpToken,
  encryptAfpRefreshToken,
  decryptAfpRefreshToken,
  encryptAuthCode,
  decryptAuthCode,
} from '../http/tokens.js';

const key = await deriveKey('a-very-long-test-secret-of-32-chars-min', 'access-token');
const resource = 'https://news-mcp.example.com/mcp';

describe('deriveKey', () => {
  it('derives a 32-byte key deterministically for the same secret + purpose', async () => {
    const again = await deriveKey('a-very-long-test-secret-of-32-chars-min', 'access-token');
    expect(key).toHaveLength(32);
    expect(Buffer.from(key).equals(Buffer.from(again))).toBe(true);
  });

  it('derives distinct keys per purpose from the same secret', async () => {
    const other = await deriveKey('a-very-long-test-secret-of-32-chars-min', 'refresh-token');
    expect(Buffer.from(key).equals(Buffer.from(other))).toBe(false);
  });
});

describe('sha256Base64Url', () => {
  it('matches the PKCE S256 test vector from RFC 7636', async () => {
    // https://datatracker.ietf.org/doc/html/rfc7636#appendix-B
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await sha256Base64Url(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('encryptAfpToken / decryptAfpToken', () => {
  it('round-trips the AFP token payload, including the resource audience', async () => {
    const payload = { at: 'access', rt: 'refresh', exp: Date.now() + 60_000, u: 'jdoe', aud: resource };
    const token = await encryptAfpToken(key, payload);
    const decoded = await decryptAfpToken(key, token);
    expect(decoded).toEqual(payload);
  });

  it('rejects a token decrypted with the wrong key', async () => {
    const otherKey = await deriveKey('a-different-very-long-test-secret-32ch', 'access-token');
    const token = await encryptAfpToken(key, { at: 'access', rt: 'refresh', exp: Date.now() + 60_000, u: 'jdoe', aud: resource });
    await expect(decryptAfpToken(otherKey, token)).rejects.toThrow();
  });
});

describe('encryptAfpRefreshToken / decryptAfpRefreshToken', () => {
  it('round-trips the refresh token and username', async () => {
    const refreshKey = await deriveKey('a-very-long-test-secret-of-32-chars-min', 'refresh-token');
    const token = await encryptAfpRefreshToken(refreshKey, 'afp-refresh-token', 'jdoe');
    const decoded = await decryptAfpRefreshToken(refreshKey, token);
    expect(decoded).toEqual({ afpRefreshToken: 'afp-refresh-token', username: 'jdoe' });
  });
});

describe('encryptAuthCode / decryptAuthCode', () => {
  it('round-trips the pending AFP token and PKCE/redirect binding — no server-side lookup needed', async () => {
    const authCodeKey = await deriveKey('a-very-long-test-secret-of-32-chars-min', 'auth-code');
    const payload = {
      u: 'jdoe',
      at: 'access',
      rt: 'refresh',
      exp: Date.now() + 60_000,
      aud: resource,
      codeChallenge: 'expected-challenge',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    };
    const code = await encryptAuthCode(authCodeKey, payload);
    const decoded = await decryptAuthCode(authCodeKey, code);
    expect(decoded).toEqual(payload);
  });

  it('rejects a code decrypted with the wrong key', async () => {
    const authCodeKey = await deriveKey('a-very-long-test-secret-of-32-chars-min', 'auth-code');
    const otherKey = await deriveKey('a-different-very-long-test-secret-32ch', 'auth-code');
    const code = await encryptAuthCode(authCodeKey, {
      u: 'jdoe', at: 'access', rt: 'refresh', exp: Date.now() + 60_000, aud: resource,
      codeChallenge: 'cc', redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    });
    await expect(decryptAuthCode(otherKey, code)).rejects.toThrow();
  });
});
