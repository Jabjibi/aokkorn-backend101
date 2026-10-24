import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../line-login/session.guard.js';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import { TripsService } from './trips.service.js';
import {
  CreateTripPipe,
  EmptyTripQueryPipe,
  type CreateTripInput,
} from './trips.dto.js';

/** HTTP boundary: DTO/path ผ่าน pipes, actor ผ่าน guard; ไม่รับ ownerUserId จาก client */
@Controller('trips')
@UseGuards(SessionGuard)
export class TripsController {
  constructor(@Inject(TripsService) private readonly trips: TripsService) {}

  /**
   * GET /api/v1/trips
   * รับ: session cookie
   * Query: ไม่มี
   * คืน: items, quota, totalsByCurrency
   */
  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query(EmptyTripQueryPipe) _query?: undefined,
  ) {
    return this.trips.list(request.auth.user.id);
  }

  /**
   * POST /api/v1/trips
   * รับ: session cookie, Origin และ X-CSRF-Token
   * Body: name, baseCurrency
   * คืน: 201 TripDetail พร้อมเจ้าของและวันแรก
   */
  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body(CreateTripPipe) input: CreateTripInput,
    @Query(EmptyTripQueryPipe) _query?: undefined,
  ) {
    return this.trips.create(request.auth.user.id, input);
  }

  /**
   * GET /api/v1/trips/:tripId
   * รับ: session cookie, path: tripId
   * Query: ไม่มี
   * คืน: TripDetail
   */
  @Get(':tripId')
  detail(
    @Req() request: AuthenticatedRequest,
    @Param(
      'tripId',
      new ParseUUIDPipe({
        version: 'all',
        exceptionFactory: () =>
          new ApiError(ERRORS.VALIDATION_FAILED, 'รหัสทริปไม่ถูกต้อง'),
      }),
    )
    tripId: string,
    @Query(EmptyTripQueryPipe) _query?: undefined,
  ) {
    return this.trips.detail(request.auth.user.id, tripId);
  }
}
