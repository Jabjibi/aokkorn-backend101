import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../line-login/session.guard.js';
import { EmptyQueryPipe } from '../../common/input.js';
import { CurrenciesService } from './currencies.service.js';

@Controller('currencies')
@UseGuards(SessionGuard)
export class CurrenciesController {
  constructor(
    @Inject(CurrenciesService) private readonly currencies: CurrenciesService,
  ) {}

  /**
   * GET /api/v1/currencies
   * รับ: session cookie
   * Query: ไม่มี
   * คืน: Currency[]: code, symbol, minorUnitDigits
   */
  @Get()
  list(@Query(new EmptyQueryPipe()) _query?: undefined) {
    return this.currencies.list();
  }
}
