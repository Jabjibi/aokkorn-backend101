import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { setupApp } from './app.setup.js';
import { LineLoginConfig } from './api/line-login/line-login.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  await app.listen(app.get(LineLoginConfig).port);
}

await bootstrap();
