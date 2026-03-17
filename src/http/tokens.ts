import { hkdfSync } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';

// Security fix #8: HKDF key derivation (replaces raw SHA-256)
export function deriveKey(secret: string, purpose: string): Uint8Array {
  return new Uint8Array(
    hkdfSync('sha256', Buffer.from(secret), Buffer.from('afp-mcp-v1'), Buffer.from(purpose), 32),
  );
}

// Access token: contains AFP API token (not user credentials)
export type AfpTokenPayload = { at: string; rt: string; exp: number; u: string };

export async function encryptAfpToken(key: Uint8Array, payload: AfpTokenPayload): Promise<string> {
  // Expire the JWE when the AFP token expires (min 60s from now)
  const ttlSeconds = Math.max(60, Math.floor((payload.exp - Date.now()) / 1000));
  return new EncryptJWT({ at: payload.at, rt: payload.rt, exp: payload.exp, u: payload.u })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .encrypt(key);
}

export async function decryptAfpToken(key: Uint8Array, token: string): Promise<AfpTokenPayload> {
  const { payload } = await jwtDecrypt(token, key);
  const { at, rt, exp, u } = payload as AfpTokenPayload;
  if (!at || !u) throw new Error('Invalid access token payload');
  return { at: at as string, rt: (rt as string) || '', exp: (exp as number) || 0, u: u as string };
}

// Refresh token: contains AFP refresh token only — no user credentials stored
export async function encryptAfpRefreshToken(key: Uint8Array, afpRefreshToken: string, username: string): Promise<string> {
  return new EncryptJWT({ rfp: afpRefreshToken, u: username })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .encrypt(key);
}

export async function decryptAfpRefreshToken(key: Uint8Array, token: string): Promise<{ afpRefreshToken: string; username: string }> {
  const { payload } = await jwtDecrypt(token, key);
  const { rfp, u } = payload as { rfp: string; u: string };
  if (!rfp || !u) throw new Error('Invalid refresh token payload');
  return { afpRefreshToken: rfp as string, username: u as string };
}
