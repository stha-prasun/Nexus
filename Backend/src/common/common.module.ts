import {
  Global,
  MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppLogger } from './logger/logger';
import { MetricsController } from './metrics/metrics.controller';
import { MetricsService } from './metrics/metrics.service';
import { MetricsReporterService } from './metrics/metrics-reporter.service';
import { RequestIdMiddleware } from './request-id.middleware';
import { HttpTracingInterceptor } from './tracing/http-tracing.interceptor';
import { InstrumentationService } from './tracing/instrumentation.service';
import { TracingService } from './tracing/tracing.service';

/**
 * Observability module: colored logging, request tracing with dependency
 * waterfalls, and in-memory metrics (GET /api/v1/metrics + periodic summary).
 *
 * Registered once in AppModule — `@Global()` means no other module has to
 * import it. `exports` still controls which providers those modules can
 * inject (AppLogger, MetricsService, TracingService).
 */
@Global()
@Module({
  providers: [
    AppLogger,
    MetricsService,
    MetricsReporterService,
    TracingService,
    InstrumentationService,
    HttpTracingInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: HttpTracingInterceptor },
  ],
  controllers: [MetricsController],
  exports: [AppLogger, MetricsService, TracingService],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // '/' matches every request — keeps us independent of path-to-regexp
    // wildcard syntax differences across Nest/Express versions.
    consumer.apply(RequestIdMiddleware).forRoutes('/');
  }
}
