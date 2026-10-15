import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UNAUTHENTICATED_MESSAGE } from './constants/auth.constants';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from './session/session.constants';
import { SessionService } from './session/session.service';

describe('AuthController', () => {
  let controller: AuthController;

  const authService = {
    register: jest.fn(),
    verifyEmail: jest.fn(),
    resendConfirmation: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    me: jest.fn(),
  };
  const sessionService = {
    setCookie: jest.fn(),
    clearCookie: jest.fn(),
  };

  const res = () =>
    ({
      status: jest.fn().mockReturnThis(),
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    }) as unknown as Response;

  const request = (sid?: string) =>
    ({ cookies: sid ? { [SESSION_COOKIE_NAME]: sid } : {} }) as never;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: SessionService, useValue: sessionService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('register delegates to the service and returns its message', async () => {
    const dto = new RegisterDto();
    authService.register.mockResolvedValue({ message: 'ok' });

    const result = await controller.register(dto);

    expect(authService.register).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ message: 'ok' });
  });

  it('verifyEmail returns the verified status with 200 (no res status set)', async () => {
    authService.verifyEmail.mockResolvedValue({ status: 'verified' });
    const response = res();

    const result = await controller.verifyEmail('tok', response);

    expect(authService.verifyEmail).toHaveBeenCalledWith('tok');
    expect(result).toEqual({ status: 'verified' });
    expect(response.status).not.toHaveBeenCalled();
  });

  it('verifyEmail sets 400 for an invalid or expired token', async () => {
    authService.verifyEmail.mockResolvedValue({
      status: 'invalid_or_expired',
    });
    const response = res();

    const result = await controller.verifyEmail('bad', response);

    expect(result).toEqual({ status: 'invalid_or_expired' });
    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('verifyEmail with a missing token queries the service with empty string', async () => {
    authService.verifyEmail.mockResolvedValue({
      status: 'invalid_or_expired',
    });

    await controller.verifyEmail(undefined, res());

    expect(authService.verifyEmail).toHaveBeenCalledWith('');
  });

  it('resendConfirmation delegates to the service', async () => {
    const dto = new ResendConfirmationDto();
    authService.resendConfirmation.mockResolvedValue({ message: 'sent' });

    const result = await controller.resendConfirmation(dto);

    expect(authService.resendConfirmation).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ message: 'sent' });
  });

  describe('login', () => {
    const user = {
      id: 'u1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'Dev' as const,
    };

    it('sets the session cookie with the returned TTL and returns the user', async () => {
      const dto = new LoginDto();
      authService.login.mockResolvedValue({
        user,
        sid: 'sid-new',
        ttlSeconds: 3600,
      });
      const response = res();

      const result = await controller.login(dto, request('sid-old'), response);

      expect(authService.login).toHaveBeenCalledWith(dto, 'sid-old');
      expect(sessionService.setCookie).toHaveBeenCalledWith(
        response,
        'sid-new',
        3600,
      );
      expect(result).toEqual({ user });
    });

    it('passes no sid when the request has no session cookie', async () => {
      const dto = new LoginDto();
      authService.login.mockResolvedValue({
        user,
        sid: 'sid-new',
        ttlSeconds: SESSION_TTL_SECONDS,
      });

      await controller.login(dto, request(), res());

      expect(authService.login).toHaveBeenCalledWith(dto, undefined);
    });

    it('does not swallow service errors (401/403/429/500 keep their status)', async () => {
      const dto = new LoginDto();
      authService.login.mockRejectedValue(new Error('nope'));

      await expect(controller.login(dto, request(), res())).rejects.toThrow(
        'nope',
      );
      expect(sessionService.setCookie).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('accepts an empty body, always clears the cookie, returns the result', async () => {
      const dto = new LogoutDto();
      authService.logout.mockResolvedValue({ message: 'bye', revoked: 1 });
      const response = res();

      const result = await controller.logout(dto, request('sid1'), response);

      expect(authService.logout).toHaveBeenCalledWith('sid1', false);
      expect(sessionService.clearCookie).toHaveBeenCalledWith(response);
      expect(result).toEqual({ message: 'bye', revoked: 1 });
    });

    it('forwards allDevices: true', async () => {
      const dto = new LogoutDto();
      dto.allDevices = true;
      authService.logout.mockResolvedValue({ message: 'bye', revoked: 2 });

      await controller.logout(dto, request('sid1'), res());

      expect(authService.logout).toHaveBeenCalledWith('sid1', true);
    });
  });

  describe('me', () => {
    const user = {
      id: 'u1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'Dev' as const,
    };

    it('returns the session snapshot on 200', async () => {
      authService.me.mockResolvedValue({ status: 'authenticated', user });
      const response = res();

      const result = await controller.me(request('sid1'), response);

      expect(authService.me).toHaveBeenCalledWith('sid1');
      expect(result).toEqual({ user });
      expect(response.status).not.toHaveBeenCalled();
      expect(sessionService.clearCookie).not.toHaveBeenCalled();
    });

    it('answers 401 and clears the stale cookie when unauthenticated', async () => {
      authService.me.mockResolvedValue({ status: 'unauthenticated' });
      const response = res();

      const result = await controller.me(request('dead'), response);

      expect(response.status).toHaveBeenCalledWith(401);
      expect(sessionService.clearCookie).toHaveBeenCalledWith(response);
      expect(result).toEqual({
        status: 'unauthenticated',
        message: UNAUTHENTICATED_MESSAGE,
      });
    });
  });
});
