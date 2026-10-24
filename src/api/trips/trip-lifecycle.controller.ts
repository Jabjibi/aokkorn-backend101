import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import {
  emptyBody,
  updateTripInput,
  type UpdateTrip,
} from './trip-lifecycle.dto.js';
import { TripLifecycleService } from './trip-lifecycle.service.js';

/** ประกาศ /deleted ก่อน dynamic /:tripId ใน TripsModule */
@Controller('trips')
@UseGuards(SessionGuard)
export class TripLifecycleController {
  constructor(
    @Inject(TripLifecycleService) private readonly trips: TripLifecycleService,
  ) {}

  /**
   * GET /api/v1/trips/deleted
   * รับ: session cookie
   * Query: ไม่มี
   * คืน: items ของเจ้าของที่ยังไม่พ้น 30 วัน
   */
  @Get('deleted')
  deleted(
    @Req() req: AuthenticatedRequest,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.trips.deleted(req.auth.user.id);
  }

  /**
   * PATCH /api/v1/trips/:tripId
   * รับ: session cookie, path: tripId, Origin และ X-CSRF-Token
   * Body: name? / baseCurrency? / exchangeSelections?
   * คืน: TripDetail ที่เปลี่ยนแล้ว
   */
  @Patch(':tripId')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) id: string,
    @Body(new BodyPipe(updateTripInput)) input: UpdateTrip,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.trips.update(req.auth.user.id, id, input);
  }

  /**
   * DELETE /api/v1/trips/:tripId
   * รับ: session cookie, path: tripId, Origin และ X-CSRF-Token
   * Body: ไม่มี
   * คืน: id, deletedAt, restoreUntil
   */
  @Delete(':tripId')
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) id: string,
    @Body(new BodyPipe(emptyBody)) _body: undefined,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.trips.remove(req.auth.user.id, id);
  }

  /**
   * POST /api/v1/trips/:tripId/restore
   * รับ: session cookie, path: tripId, Origin และ X-CSRF-Token
   * Body: ไม่มี
   * คืน: 200 TripDetail เมื่อกู้คืนได้และโควตาไม่เต็ม
   */
  @Post(':tripId/restore')
  @HttpCode(200)
  restore(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) id: string,
    @Body(new BodyPipe(emptyBody)) _body: undefined,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.trips.restore(req.auth.user.id, id);
  }
}
