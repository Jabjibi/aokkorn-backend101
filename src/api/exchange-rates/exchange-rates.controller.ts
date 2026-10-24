import { ThrottlerGuard } from '@nestjs/throttler';
import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../line-login/session.guard.js';
import { BodyPipe } from '../../common/input.js';
import { quoteQuery } from './exchange.dto.js';
import { ExchangeRatesService } from './exchange-rates.service.js';

@Controller('exchange-rates')
@UseGuards(SessionGuard, ThrottlerGuard)
export class ExchangeRatesController {
  constructor(
    @Inject(ExchangeRatesService) private readonly rates: ExchangeRatesService,
  ) {}

  /**
   * GET /api/v1/exchange-rates/quote
   * รับ: session cookie
   * Query: query: from, to
   * คืน: quoteId, rate, source, capturedAt, expiresAt, คู่สกุล
   */
  @Get('quote')
  quote(
    @Req() request: AuthenticatedRequest,
    @Query(new BodyPipe(quoteQuery)) query: ReturnType<typeof quoteQuery>,
  ) {
    return this.rates.quote(request.auth.user.id, query.from, query.to);
  }
}
