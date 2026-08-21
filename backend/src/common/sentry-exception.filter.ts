import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

// Only real bugs get reported — a 400 from bad user input isn't one.
// GlitchTip stays useful (signal, not noise from malformed requests).
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const isClientError = exception instanceof HttpException && exception.getStatus() < 500;
    if (!isClientError) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }
}
