import { HealthModule } from './api/health/health.module.js';
import { SummaryModule } from './api/summary/summary.module.js';
import { ObligationsModule } from './api/obligations/obligations.module.js';
import { ExpensesModule } from './api/expenses/expenses.module.js';
import { TripDaysModule } from './api/trip-days/trip-days.module.js';
import { ParticipantsModule } from './api/participants/participants.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TripsModule } from './api/trips/trips.module.js';
import { LineLoginModule } from './api/line-login/line-login.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    LineLoginModule,
    TripsModule,
    HealthModule,
    SummaryModule,
    ObligationsModule,
    ExpensesModule,
    TripDaysModule,
    ParticipantsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
