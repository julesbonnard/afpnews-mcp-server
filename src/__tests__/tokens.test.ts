import { describe, expect, it } from 'bun:test';
import { deriveKey, encryptAfpToken, decryptAfpToken, encryptAfpRefreshToken, decryptAfpRefreshToken } from '../http/tokens.js';

const key = deriveKey('a-very-long-test-secret-of-32-chars-min', 'access-token');
const resource = 'https://news-mcp.example.com/mcp';

describe('encryptAfpToken / decryptAfpToken', () => {
  it('round-trips the AFP token payload, including the resource audience', async () => {
    const payload = { at: 'access', rt: 'refresh', exp: Date.now() + 60_000, u: 'jdoe', aud: resource };
    const token = await encryptAfpToken(key, payload);
    const decoded = await decryptAfpToken(key, token);
    expect(decoded).toEqual(payload);
  });

  it('rejects a token decrypted with the wrong key', async () => {
    const otherKey = deriveKey('a-different-very-long-test-secret-32ch', 'access-token');
    const token = await encryptAfpToken(key, { at: 'access', rt: 'refresh', exp: Date.now() + 60_000, u: 'jdoe', aud: resource });
    await expect(decryptAfpToken(otherKey, token)).rejects.toThrow();
  });
});

describe('encryptAfpRefreshToken / decryptAfpRefreshToken', () => {
  it('round-trips the refresh token and username', async () => {
    const refreshKey = deriveKey('a-very-long-test-secret-of-32-chars-min', 'refresh-token');
    const token = await encryptAfpRefreshToken(refreshKey, 'afp-refresh-token', 'jdoe');
    const decoded = await decryptAfpRefreshToken(refreshKey, token);
    expect(decoded).toEqual({ afpRefreshToken: 'afp-refresh-token', username: 'jdoe' });
  });
});
