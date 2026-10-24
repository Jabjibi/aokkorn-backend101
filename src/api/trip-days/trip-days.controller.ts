import {
  Body,
  Controller,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BodyPipe, EmptyQueryPipe, IdPipe } from '../../common/input.js';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../line-login/session.guard.js';
import { createDayInput, updateDayInput } from './trip-days.dto.js';
import { TripDaysService } from './trip-days.service.js';

@Controller('trips/:tripId/days')
@UseGuards(SessionGuard)
export class TripDaysController {
  constructor(
    @Inject(TripDaysService) private readonly service: TripDaysService,
  ) {}

  /**
   * POST /api/v1/trips/:tripId/days
   * รับ: session cookie, path: tripId, Origin และ X-CSRF-Token
   * Body: name? หรือ {}
   * คืน: 201 day; ไม่ส่งชื่อได้ วัน N
   */
  @Post('')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Body(new BodyPipe(createDayInput)) body: ReturnType<typeof createDayInput>,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.service.create(req.auth.user.id, tripId, body);
  }

  /**
   * PATCH /api/v1/trips/:tripId/days/:dayId
   * รับ: session cookie, path: tripId, dayId, Origin และ X-CSRF-Token
   * Body: name
   * คืน: day ที่แก้แล้ว
   */
  @Patch(':dayId')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Param('dayId', new IdPipe()) id: string,
    @Body(new BodyPipe(updateDayInput)) body: ReturnType<typeof updateDayInput>,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.service.update(req.auth.user.id, tripId, id, body);
  }
}
