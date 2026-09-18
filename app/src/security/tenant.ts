/**
 * Tenant guards: role checks + ownership assertions (IDOR-safe).
 */
import type { FastifyRequest } from 'fastify';
import { forbidden, notFound, unauthenticated } from '../core/errors.js';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

/**
 * preHandler factory restricting a route to the given roles.
 * Must run after requireAuth (reads request.currentUser).
 */
export function requireRole(...roles: Role[]): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    const user = request.currentUser;
    if (user === undefined) throw unauthenticated();
    if (!roles.includes(user.role)) throw forbidden('این عملیات فقط برای مدیران مجاز است.');
  };
}

/**
 * Assert a tenant row belongs to the given user. Missing or foreign rows both
 * yield NOT_FOUND to avoid resource-existence disclosure.
 */
export function assertOwnership<T extends { userId: number }>(row: T | null | undefined, userId: number): T {
  if (row === null || row === undefined || row.userId !== userId) throw notFound();
  return row;
}
