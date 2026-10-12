import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/logger';
import { setupSwagger } from './common/swagger/setup-swagger';
import { SWAGGER_ENABLED, SWAGGER_PATH } from './common/swagger/swagger.config';

async function bootstrap(): Promise<void> {
  const logger = new AppLogger();
  const app = await NestFactory.create(AppModule, { logger });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  setupSwagger(app, logger);

  process.on('uncaughtException', (error: Error) => {
    logger.error(`uncaught exception: ${error.message}`, {
      stack: error.stack,
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const error = reason instanceof Error ? reason : undefined;
    logger.error(
      `unhandled rejection: ${error?.message ?? String(reason)}`,
      error ? { stack: error.stack } : undefined,
    );
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  const url = `http://localhost:${port}`;
  const log = logger.child('bootstrap');
  log.info(`API     ${url}/api/v1`);
  if (SWAGGER_ENABLED) {
    log.info(`Swagger ${url}/${SWAGGER_PATH}`);
  }
}

void bootstrap();
