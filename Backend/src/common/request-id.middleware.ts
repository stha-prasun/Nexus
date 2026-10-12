import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { newTraceId } from './tracing/trace-context';

const TRACE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Assigns every request a trace id — honoring an incoming `x-request-id`
 * (so calls stay correlated across services) or generating a fresh one.
 * Propagated downstream via request headers and echoed in the response.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const raw = req.headers['x-request-id'];
    const incoming = Array.isArray(raw) ? raw[0] : raw;
    const traceId =
      incoming && TRACE_ID_RE.test(incoming) ? incoming : newTraceId();

    req.headers['x-request-id'] = traceId;
    res.setHeader('x-request-id', traceId);
    next();
  }
}
