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
  // Vite frontend (:5173 by default) calls the API cross-origin with cookies.
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    credentials: true,
  });
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
