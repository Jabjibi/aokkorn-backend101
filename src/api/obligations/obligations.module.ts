import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module.js';
import { LineLoginModule } from '../line-login/line-login.module.js';
import { CurrenciesModule } from '../currencies/currencies.module.js';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module.js';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { ObligationsController } from './obligations.controller.js';
import { ObligationsService } from './obligations.service.js';
import { ObligationsRepository } from './obligations.repository.js';

@Module({
  imports: [
    TripsModule,
    LineLoginModule,
    CurrenciesModule,
    ExchangeRatesModule,
    ExpensesModule,
  ],
  controllers: [ObligationsController],
  providers: [ObligationsService, ObligationsRepository],
})
export class ObligationsModule {}
