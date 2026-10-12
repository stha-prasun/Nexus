import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/logger';

async function bootstrap(): Promise<void> {
  const logger = new AppLogger();
  const app = await NestFactory.create(AppModule, { logger });
  app.enableShutdownHooks();

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

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
