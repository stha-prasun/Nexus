import { DocumentBuilder } from '@nestjs/swagger';

/** Serves the interactive docs unless explicitly disabled. */
export const SWAGGER_ENABLED = !['false', '0', 'no'].includes(
  (process.env.SWAGGER_ENABLED ?? 'true').toLowerCase(),
);

/** URL the UI is mounted on; the raw document lives at `<path>-json`. */
export const SWAGGER_PATH = process.env.SWAGGER_PATH || 'api-docs';

/**
 * OpenAPI document shell: title, version and global schemes. Endpoint
 * metadata comes from @ApiTags/@ApiOperation/@ApiResponse on controllers.
 */
export const swaggerDocumentConfig = new DocumentBuilder()
  .setTitle('Nexus API')
  .setDescription(
    'Nexus backend HTTP API — health probes and in-process observability metrics.',
  )
  .setVersion('0.0.1') // keep in sync with package.json
  .build();
