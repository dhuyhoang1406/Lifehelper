import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (request, response) => {
          const supplied = request.headers[CORRELATION_ID_HEADER];
          const correlationId =
            (Array.isArray(supplied) ? supplied[0] : supplied) || randomUUID();
          response.setHeader(CORRELATION_ID_HEADER, correlationId);
          return correlationId;
        },
        customProps: (request) => ({ correlationId: request.id }),
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class StructuredLoggerModule {}
