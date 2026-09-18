/**
 * Fastify type augmentations: request.currentUser + reply envelope decorators.
 */
import type { FastifyReply } from 'fastify';

export interface CurrentUser {
  id: number;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER';
  status: 'ACTIVE' | 'SUSPENDED';
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
  interface FastifyReply {
    sendOk: (data: unknown, status?: number) => FastifyReply;
    sendCreated: (data: unknown) => FastifyReply;
  }
}
