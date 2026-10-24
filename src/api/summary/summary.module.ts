import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module.js';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { LineLoginModule } from '../line-login/line-login.module.js';
import { SummaryService } from './summary.service.js';
import { SummaryController } from './summary.controller.js';

@Module({
  imports: [TripsModule, ExpensesModule, LineLoginModule],
  controllers: [SummaryController],
  providers: [SummaryService],
})
export class SummaryModule {}
