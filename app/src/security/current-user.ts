/**
 * Small helper shared by module routes: narrows request.currentUser after the
 * requireAuth preHandler (which guarantees it is set).
 */
import type { FastifyRequest } from 'fastify';
import { unauthenticated } from '../core/errors.js';
import type { CurrentUser } from '../plugins/auth.js';

export function requireUser(request: FastifyRequest): CurrentUser {
  const user = request.currentUser;
  if (user === undefined) throw unauthenticated();
  return user;
}
