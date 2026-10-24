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
import { emptyBody } from '../trips/trip-lifecycle.dto.js';
import {
  expenseInput,
  expensePatchInput,
  parseTextInput,
  type ExpenseInput,
  type ExpensePatch,
} from './expenses.dto.js';
import { ExpensesService } from './expenses.service.js';

@Controller('trips/:tripId')
@UseGuards(SessionGuard)
export class ExpensesController {
  constructor(
    @Inject(ExpensesService) private readonly expenses: ExpensesService,
  ) {}

  /**
   * GET /api/v1/trips/:tripId/days/:dayId/expenses
   * รับ: session cookie, path: tripId, dayId
   * Query: ไม่มี
   * คืน: items, total, originalTotals
   */
  @Get('days/:dayId/expenses')
  listDay(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Param('dayId', new IdPipe()) dayId: string,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.expenses.listDay(req.auth.user.id, tripId, dayId);
  }

  /**
   * POST /api/v1/trips/:tripId/expenses/parse
   * รับ: session cookie, path: tripId, Origin และ X-CSRF-Token
   * Body: text, currency
   * คืน: 200 name, amount; ไม่มีการบันทึก
   */
  @Post('expenses/parse')
  @HttpCode(200)
  parse(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Body(new BodyPipe(parseTextInput))
    input: ReturnType<typeof parseTextInput>,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.expenses.parse(req.auth.user.id, tripId, input);
  }

  /**
   * POST /api/v1/trips/:tripId/expenses/preview
   * รับ: session cookie, path: tripId, Origin และ X-CSRF-Token
   * Body: ExpenseInput
   * คืน: 200 draft พร้อม shares/obligations/FX; ไม่มีการบันทึก
   */
  @Post('expenses/preview')
  @HttpCode(200)
  preview(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Body(new BodyPipe(expenseInput)) input: ExpenseInput,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.expenses.preview(req.auth.user.id, tripId, input);
  }

  /**
   * POST /api/v1/trips/:tripId/expenses
   * รับ: session cookie, path: tripId, Origin และ X-CSRF-Token
   * Body: ExpenseInput
   * คืน: 201 ExpenseView พร้อม children ทั้งชุด
   */
  @Post('expenses')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Body(new BodyPipe(expenseInput)) input: ExpenseInput,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.expenses.create(req.auth.user.id, tripId, input);
  }

  /**
   * GET /api/v1/trips/:tripId/expenses/:expenseId
   * รับ: session cookie, path: tripId, expenseId
   * Query: ไม่มี
   * คืน: ExpenseView
   */
  @Get('expenses/:expenseId')
  detail(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Param('expenseId', new IdPipe()) id: string,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.expenses.detail(req.auth.user.id, tripId, id);
  }

  /**
   * PATCH /api/v1/trips/:tripId/expenses/:expenseId
   * รับ: session cookie, path: tripId, expenseId, Origin และ X-CSRF-Token
   * Body: partial ExpenseInput อย่างน้อยหนึ่ง field
   * คืน: ExpenseView ที่แก้แล้ว
   */
  @Patch('expenses/:expenseId')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Param('expenseId', new IdPipe()) id: string,
    @Body(new BodyPipe(expensePatchInput)) input: ExpensePatch,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.expenses.update(req.auth.user.id, tripId, id, input);
  }

  /**
   * DELETE /api/v1/trips/:tripId/expenses/:expenseId
   * รับ: session cookie, path: tripId, expenseId, Origin และ X-CSRF-Token
   * Body: ไม่มี
   * คืน: id, deleted: true
   */
  @Delete('expenses/:expenseId')
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('tripId', new IdPipe()) tripId: string,
    @Param('expenseId', new IdPipe()) id: string,
    @Body(new BodyPipe(emptyBody)) _body: undefined,
    @Query(new EmptyQueryPipe()) _query?: undefined,
  ) {
    return this.expenses.remove(req.auth.user.id, tripId, id);
  }
}
