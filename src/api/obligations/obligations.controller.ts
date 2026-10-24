import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BodyPipe, EmptyQueryPipe, IdPipe } from '../../common/input.js';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../line-login/session.guard.js';
import { emptyBody } from '../trips/trip-lifecycle.dto.js';
import {
  settlementInput,
  settlementPreviewInput,
  type SettlementInput,
} from './obligations.dto.js';
import { ObligationsService } from './obligations.service.js';

@Controller('trips/:tripId/obligations/:obligationId/settlement')
@UseGuards(SessionGuard)
export class ObligationsController {
  constructor(
    @Inject(ObligationsService)
    private readonly obligations: ObligationsService,
  ) {}

  /**
   * POST /api/v1/trips/:tripId/obligations/:obligationId/settlement/preview
   * รับ: session cookie, path: tripId, obligationId, Origin และ X-CSRF-Token
   * Body: currency, exchange?
   * คืน: 200 originalAmount, expectedPaidAmount, fxSnapshot
   */
  @Post('preview')
  @HttpCode(200)
  preview(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Param('obligationId', new IdPipe()) id: string,
    @Body(new BodyPipe(settlementPreviewInput))
    input: ReturnType<typeof settlementPreviewInput>,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.obligations.preview(req.auth.user.id, tripId, id, input);
  }

  /**
   * PUT /api/v1/trips/:tripId/obligations/:obligationId/settlement
   * รับ: session cookie, path: tripId, obligationId, Origin และ X-CSRF-Token
   * Body: paidAmount, exchange?
   * คืน: obligation สถานะ paid และ settlement
   */
  @Put()
  settle(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Param('obligationId', new IdPipe()) id: string,
    @Body(new BodyPipe(settlementInput)) input: SettlementInput,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.obligations.settle(req.auth.user.id, tripId, id, input);
  }

  /**
   * DELETE /api/v1/trips/:tripId/obligations/:obligationId/settlement
   * รับ: session cookie, path: tripId, obligationId, Origin และ X-CSRF-Token
   * Body: ไม่มี
   * คืน: obligation สถานะ unpaid; settlement: null
   */
  @Delete()
  clear(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Param('obligationId', new IdPipe()) id: string,
    @Body(new BodyPipe(emptyBody)) _body: undefined,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.obligations.clear(req.auth.user.id, tripId, id);
  }
}
