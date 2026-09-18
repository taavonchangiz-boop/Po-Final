/**
 * Response envelope + error handler mapping everything to the API contract:
 * { success, data } | { success:false, error:{ code, message, requestId } }.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

type ErrorHandlerFn = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => void;

const GENERIC_INTERNAL = 'خطای داخلی سرور. لطفاً بعداً تلاش کنید.';
const GENERIC_VALIDATION = 'داده‌های ارسالی معتبر نیست.';
const REQUIRED_MESSAGE = 'این فیلد الزامی است.';
const INVALID_MESSAGE = 'مقدار واردشده معتبر نیست.';

export function sendOk(reply: FastifyReply, data: unknown, status = 200): FastifyReply {
  return reply.status(status).send({ success: true, data });
}

export function sendCreated(reply: FastifyReply, data: unknown): FastifyReply {
  return sendOk(reply, data, 201);
}

function zodFieldMessages(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    if (fields[path] !== undefined) continue;
    const received = 'received' in issue ? (issue as { received?: unknown }).received : undefined;
    fields[path] =
      issue.code === 'invalid_type' && (received === 'undefined' || received === 'null')
        ? REQUIRED_MESSAGE
        : INVALID_MESSAGE;
  }
  return fields;
}

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
    fields?: Record<string, string>;
    details?: unknown;
  };
}

function sendError(reply: FastifyReply, status: number, body: ErrorBody): FastifyReply {
  return reply.status(status).send(body);
}

/** Fastify error handler factory mapping AppError/ZodError/framework errors to the contract. */
export function errorHandler(): ErrorHandlerFn {
  return (error: FastifyError, request: FastifyRequest, reply: FastifyReply): void => {
    const requestId = request.id;
    let status: number;
    let body: ErrorBody;

    if (error instanceof AppError) {
      status = error.status;
      body = {
        success: false,
        error: {
          code: error.code,
          message: error.expose ? error.message : GENERIC_INTERNAL,
          requestId,
        },
      };
      if (error.expose && error.details !== undefined && env.NODE_ENV === 'development') {
        body.error.details = error.details;
      }
    } else if (error instanceof ZodError) {
      status = 400;
      body = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: GENERIC_VALIDATION,
          requestId,
          fields: zodFieldMessages(error),
        },
      };
    } else if (error.statusCode === 429) {
      status = 429;
      body = {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'درخواست‌های شما بیش از حد مجاز است. لطفاً کمی بعد تلاش کنید.',
          requestId,
        },
      };
    } else if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      status = error.statusCode;
      body = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: GENERIC_VALIDATION, requestId },
      };
    } else {
      status = 500;
      body = {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: GENERIC_INTERNAL, requestId },
      };
    }

    const logPayload = {
      requestId,
      method: request.method,
      url: request.url,
      statusCode: status,
      code: body.error.code,
    };
    if (status >= 500) {
      logger.error(error.message, { ...logPayload, stack: error.stack });
    } else {
      logger.warn(error.message, logPayload);
    }

    sendError(reply, status, body);
  };
}
