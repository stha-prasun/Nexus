import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import type { AppLogger } from '../logger/logger';
import {
  SWAGGER_ENABLED,
  SWAGGER_PATH,
  swaggerDocumentConfig,
} from './swagger.config';

/**
 * Mounts the docs; called from main.ts after the app is created:
 *
 *   GET /api-docs      → interactive Swagger UI
 *   GET /api-docs-json → raw OpenAPI document
 *
 * Full URLs are printed by the bootstrap log once the server listens.
 * No-op when SWAGGER_ENABLED=false.
 */
export const setupSwagger = (
  app: INestApplication,
  logger: AppLogger,
): void => {
  const log = logger.child('swagger');
  if (!SWAGGER_ENABLED) {
    log.debug('disabled (SWAGGER_ENABLED=false)');
    return;
  }
  const document = SwaggerModule.createDocument(app, swaggerDocumentConfig);
  SwaggerModule.setup(SWAGGER_PATH, app, document);
};
