import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { TypedLogger } from './logger/logger.service.js';
import { QueueService } from './modules/worker/queue.service.js';
import type { NestExpressApplication } from '@nestjs/platform-express';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: false,
  });
  app.useBodyParser('json', { limit: '8mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableShutdownHooks();
  try {
    await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'));
    await app.get(QueueService).waitForFailure();
    process.exitCode = 1;
  } finally {
    await app.close();
  }
};

try {
  await bootstrap();
} catch {
  new TypedLogger('Bootstrap').error({
    message:
      'Worker startup failed; verify configuration and broker availability',
  });
  process.exitCode = 1;
}
