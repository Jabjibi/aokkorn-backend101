import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module.js';
import { LineLoginModule } from '../line-login/line-login.module.js';
import { CurrenciesModule } from '../currencies/currencies.module.js';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';
import { ExpensesRepository } from './expenses.repository.js';
import { ExpenseReadRepository } from './expense-read.repository.js';

@Module({
  imports: [
    TripsModule,
    LineLoginModule,
    CurrenciesModule,
    ExchangeRatesModule,
  ],
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpensesRepository, ExpenseReadRepository],
  exports: [ExpenseReadRepository],
})
export class ExpensesModule {}
