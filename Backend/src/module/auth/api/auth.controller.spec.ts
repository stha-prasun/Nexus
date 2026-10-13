import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';

describe('AuthController', () => {
  let controller: AuthController;

  const authService = {
    register: jest.fn(),
    verifyEmail: jest.fn(),
    resendConfirmation: jest.fn(),
  };

  const res = () =>
    ({ status: jest.fn().mockReturnThis() }) as unknown as Response;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
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
});
