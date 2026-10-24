import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { EmptyQueryPipe, IdPipe } from '../../common/input.js';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../line-login/session.guard.js';
import { SummaryService } from './summary.service.js';

@Controller('trips/:tripId/summary')
@UseGuards(SessionGuard)
export class SummaryController {
  constructor(
    @Inject(SummaryService) private readonly summary: SummaryService,
  ) {}

  /**
   * GET /api/v1/trips/:tripId/summary
   * รับ: session cookie, path: tripId
   * Query: ไม่มี
   * คืน: trip, days, expenses, obligations, totals
   */
  @Get()
  detail(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) id: string,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.summary.detail(req.auth.user.id, id);
  }
}
