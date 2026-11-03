import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';
import {
  FILE_REQUIRED_MESSAGE,
  FILE_REQUIRED_STATUS,
  FILE_TOO_LARGE_MESSAGE,
  FILE_TOO_LARGE_STATUS,
} from '../constants/documents.constants';

/**
 * Maps multer's own limit errors — thrown inside `FileInterceptor`, i.e.
 * *before* the controller handler runs — onto the repo's
 * `{ status, message }` error vocabulary (plan §5):
 *
 * - `LIMIT_FILE_SIZE` → **413** `file_too_large` (the interceptor's 25 MB
 *   gate; the service re-checks after as defense in depth).
 * - `LIMIT_FILE_COUNT` / `LIMIT_UNEXPECTED_FILE` → **400** `file_required`
 *   (exactly one file under the `file` field).
 * - Anything else is re-thrown for Nest's default handling.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped =
      exception.code === 'LIMIT_FILE_SIZE'
        ? new PayloadTooLargeException({
            status: FILE_TOO_LARGE_STATUS,
            message: FILE_TOO_LARGE_MESSAGE,
          })
        : new BadRequestException({
            status: FILE_REQUIRED_STATUS,
            message: FILE_REQUIRED_MESSAGE,
          });
    response
      .status(mapped.getStatus())
      .json(mapped.getResponse() as Record<string, unknown>);
  }
}
