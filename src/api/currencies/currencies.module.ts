import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { LineLoginModule } from '../line-login/line-login.module.js';
import { CurrenciesService } from './currencies.service.js';
import { CurrenciesController } from './currencies.controller.js';

@Module({
  imports: [DatabaseModule, LineLoginModule],
  controllers: [CurrenciesController],
  providers: [CurrenciesService],
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
