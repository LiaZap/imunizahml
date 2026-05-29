import type { FastifyReply, FastifyRequest } from 'fastify';
import { AUTH_COOKIE, verifySession, type SessionPayload } from '../services/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionPayload;
  }
}

export async function authGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) {
    return reply.code(401).send({ error: 'unauthenticated' });
  }
  const session = await verifySession(token);
  if (!session) {
    return reply.code(401).send({ error: 'invalid_session' });
  }
  req.session = session;
}

export function requireRole(...roles: Array<'admin' | 'attendant' | 'secretary'>) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.session) return reply.code(401).send({ error: 'unauthenticated' });
    if (!roles.includes(req.session.role)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  };
}
