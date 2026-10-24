import {
  Body,
  Controller,
  Delete,
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
import { participantInput } from './participants.dto.js';
import { emptyBody } from '../trips/trip-lifecycle.dto.js';
import { ParticipantsService } from './participants.service.js';

@Controller('trips/:tripId/participants')
@UseGuards(SessionGuard)
export class ParticipantsController {
  constructor(
    @Inject(ParticipantsService) private readonly service: ParticipantsService,
  ) {}

  /**
   * POST /api/v1/trips/:tripId/participants
   * รับ: session cookie, path: tripId, Origin และ X-CSRF-Token
   * Body: displayName
   * คืน: 201 participant; ไม่มีบัญชี LINE ของ guest
   */
  @Post('')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Body(new BodyPipe(participantInput))
    body: ReturnType<typeof participantInput>,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.service.create(req.auth.user.id, tripId, body);
  }

  /**
   * PATCH /api/v1/trips/:tripId/participants/:participantId
   * รับ: session cookie, path: tripId, participantId, Origin และ X-CSRF-Token
   * Body: displayName
   * คืน: participant ที่แก้แล้ว
   */
  @Patch(':participantId')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Param('participantId', new IdPipe()) id: string,
    @Body(new BodyPipe(participantInput))
    body: ReturnType<typeof participantInput>,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.service.update(req.auth.user.id, tripId, id, body);
  }

  /**
   * DELETE /api/v1/trips/:tripId/participants/:participantId
   * รับ: session cookie, path: tripId, participantId, Origin และ X-CSRF-Token
   * Body: ไม่มี
   * คืน: id, deleted: true
   */
  @Delete(':participantId')
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Param('participantId', new IdPipe()) id: string,
    @Body(new BodyPipe(emptyBody)) _body: ReturnType<typeof emptyBody>,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.service.remove(req.auth.user.id, tripId, id);
  }
}
