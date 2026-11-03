import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { UNAUTHENTICATED_MESSAGE } from '../constants/auth.constants';
import {
  LAST_ACTIVE_WRITE_INTERVAL_MS,
  SESSION_COOKIE_NAME,
} from '../session/session.constants';
import { SessionService } from '../session/session.service';
import type { SessionData, SessionUser } from '../session/session.types';

/** Express request after SessionAuthGuard — the session snapshot is attached. */
export interface AuthenticatedRequest extends Request {
  user: SessionUser;
}

const unauthenticated = (): UnauthorizedException =>
  new UnauthorizedException({
    status: 'unauthenticated',
    message: UNAUTHENTICATED_MESSAGE,
  });

/**
 * Resolves the `nexus_sid` cookie to a Redis session snapshot and attaches
 * it to `req.user`. Missing/invalid/expired/corrupt sessions → 401; Redis
 * outages propagate as 500 — a transient outage must never sign the client
 * out. Also stamps `lastActiveAt` (throttled, fire-and-forget) so the
 * session-list UI can show real activity — a failed stamp is logged, never
 * fails the request.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = request.cookies?.[SESSION_COOKIE_NAME] as unknown;
    const sid = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    if (sid === undefined) {
      throw unauthenticated();
    }

    let session: SessionData | null;
    try {
      session = await this.sessions.get(sid);
    } catch (error) {
      // A corrupt payload is a dead session; anything else is infrastructure
      // (e.g. a Redis outage) and must surface as 500, not 401.
      if (!(error instanceof SyntaxError)) throw error;
      throw unauthenticated();
    }
    if (session === null) {
      throw unauthenticated();
    }

    request.user = session;
    this.stampActivity(sid, session);
    return true;
  }

  /** Best-effort, throttled lastActiveAt rewrite — never blocks the request. */
  private stampActivity(sid: string, session: SessionData): void {
    const last = Date.parse(session.lastActiveAt ?? session.createdAt ?? '');
    if (
      Number.isFinite(last) &&
      Date.now() - last < LAST_ACTIVE_WRITE_INTERVAL_MS
    ) {
      return;
    }
    void this.sessions.recordActivity(sid, session);
  }
}
