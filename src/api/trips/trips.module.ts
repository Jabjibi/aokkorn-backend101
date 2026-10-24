import { TripAccessService } from './trip-access.service.js';
import { TripLifecycleController } from './trip-lifecycle.controller.js';
import { TripLifecycleService } from './trip-lifecycle.service.js';
import { TripLifecycleRepository } from './trip-lifecycle.repository.js';
import { CurrenciesModule } from '../currencies/currencies.module.js';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { LineLoginModule } from '../line-login/line-login.module.js';
import { TripsController } from './trips.controller.js';
import { TripsService } from './trips.service.js';
import { TripsRepository } from './trips.repository.js';
import { CreateTripPipe, EmptyTripQueryPipe } from './trips.dto.js';

@Module({
  imports: [
    DatabaseModule,
    LineLoginModule,
    CurrenciesModule,
    ExchangeRatesModule,
  ],
  controllers: [TripLifecycleController, TripsController],
  exports: [TripAccessService, TripsRepository],
  providers: [
    TripAccessService,
    TripLifecycleService,
    TripLifecycleRepository,
    TripsService,
    TripsRepository,
    CreateTripPipe,
    EmptyTripQueryPipe,
  ],
})
export class TripsModule {}
