import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../env.js';

const encoder = new TextEncoder();
const secretKey = encoder.encode(env.AUTH_SECRET);

export const AUTH_COOKIE = 'imuniza_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  sub: string;
  tenantId: string;
  role: 'admin' | 'attendant' | 'secretary';
  email: string;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setSubject(payload.sub)
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    if (
      typeof payload.sub === 'string' &&
      typeof payload.tenantId === 'string' &&
      (payload.role === 'admin' ||
        payload.role === 'attendant' ||
        payload.role === 'secretary') &&
      typeof payload.email === 'string'
    ) {
      return {
        sub: payload.sub,
        tenantId: payload.tenantId,
        role: payload.role,
        email: payload.email,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: env.NODE_ENV === 'production',
    maxAge: MAX_AGE_SECONDS,
  };
}
