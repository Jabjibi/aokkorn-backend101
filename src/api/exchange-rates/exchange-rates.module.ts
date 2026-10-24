import { ExpenseSnapshotRepository } from './expense-snapshot.repository.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LineLoginModule } from '../line-login/line-login.module.js';
import { CurrenciesModule } from '../currencies/currencies.module.js';
import {
  FX_INVOKE,
  LambdaFxClient,
  LambdaFxTransport,
} from './lambda-fx.client.js';
import { ExchangeRatesService } from './exchange-rates.service.js';
import { ExchangeRatesController } from './exchange-rates.controller.js';

@Module({
  imports: [ConfigModule, LineLoginModule, CurrenciesModule],
  controllers: [ExchangeRatesController],
  providers: [
    ExpenseSnapshotRepository,
    LambdaFxClient,
    LambdaFxTransport,
    ExchangeRatesService,
    {
      provide: FX_INVOKE,
      useFactory: (transport: LambdaFxTransport) => transport.invoke,
      inject: [LambdaFxTransport],
    },
  ],
  exports: [ExchangeRatesService, ExpenseSnapshotRepository],
})
export class ExchangeRatesModule {}
