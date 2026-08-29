import { EncryptJWT, jwtDecrypt } from 'jose';

const utf8 = new TextEncoder();

export async function deriveKey(secret: string, purpose: string): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', utf8.encode(secret), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8.encode('afp-mcp-v1'), info: utf8.encode(purpose) },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8.encode(input));
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type AfpTokenPayload = { at: string; rt: string; exp: number; u: string; aud: string };

export async function encryptAfpToken(key: Uint8Array, payload: AfpTokenPayload): Promise<string> {
  // Expire the JWE when the AFP token expires (min 60s from now)
  const ttlSeconds = Math.max(60, Math.floor((payload.exp - Date.now()) / 1000));

  return new EncryptJWT({ at: payload.at, rt: payload.rt, texp: payload.exp, u: payload.u, aud: payload.aud })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .encrypt(key);
}

export async function decryptAfpToken(key: Uint8Array, token: string): Promise<AfpTokenPayload> {
  const { payload } = await jwtDecrypt(token, key);
  const { at, rt, texp, u, aud } = payload as { at: string; rt: string; texp: number; u: string; aud: string };
  if (!at || !u) throw new Error('Invalid access token payload');
  return { at: at as string, rt: (rt as string) || '', exp: (texp as number) || 0, u: u as string, aud: (aud as string) || '' };
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

export type AuthCodePayload = { u: string; at: string; rt: string; exp: number; aud: string; codeChallenge: string; redirectUri: string };

const AUTH_CODE_TTL_SECONDS = 60;

export async function encryptAuthCode(key: Uint8Array, payload: AuthCodePayload): Promise<string> {
  return new EncryptJWT({
    u: payload.u,
    at: payload.at,
    rt: payload.rt,
    texp: payload.exp,
    aud: payload.aud,
    cc: payload.codeChallenge,
    ru: payload.redirectUri,
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${AUTH_CODE_TTL_SECONDS}s`)
    .encrypt(key);
}

export async function decryptAuthCode(key: Uint8Array, token: string): Promise<AuthCodePayload> {
  const { payload } = await jwtDecrypt(token, key);
  const { u, at, rt, texp, aud, cc, ru } = payload as { u: string; at: string; rt: string; texp: number; aud: string; cc: string; ru: string };
  if (!u || !at || !cc || !ru) throw new Error('Invalid auth code payload');
  return { u, at, rt: rt || '', exp: texp || 0, aud: aud || '', codeChallenge: cc, redirectUri: ru };
}
