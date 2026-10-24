import { Injectable, type PipeTransform } from '@nestjs/common';
import {
  objectInput,
  nameInput,
  currencyInput,
  MAX_NAME_LENGTH,
  EmptyQueryPipe,
} from '../../common/input.js';
import { sumMoney, type Money } from '../../common/money.js';

export type { Money } from '../../common/money.js';

import { ERRORS } from '../../common/api-error.filter.js';

export const TRIP_LIMIT = 5;

export const MAX_TRIP_NAME_LENGTH = MAX_NAME_LENGTH;

export type CreateTripInput = { name: string; baseCurrency: string };

export interface TripView {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: string;
  updatedAt: string;
  participantCount: number;
  expenseCount: number;
  total: Money;
  originalTotals: Money[];
}

export interface ParticipantView {
  id: string;
  displayName: string;
  sortOrder: number;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DayView {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  expenseCount: number;
  total: Money;
  originalTotals: Money[];
}

export type TripDetail = TripView & {
  participants: ParticipantView[];
  days: DayView[];
};

/** Pure: unknown body → whitelist DTO; ปฏิเสธ owner/id/ฟิลด์ระบบ ไม่ coerce ชนิดข้อมูล */
export function parseCreateTrip(value: unknown): CreateTripInput {
  const body = objectInput(value, ['name', 'baseCurrency']);
  return {
    name: nameInput(body.name, ERRORS.TRIP_NAME_REQUIRED, MAX_TRIP_NAME_LENGTH),
    baseCurrency: currencyInput(body.baseCurrency),
  };
}

@Injectable()
export class CreateTripPipe implements PipeTransform<unknown, CreateTripInput> {
  transform(value: unknown): CreateTripInput {
    return parseCreateTrip(value);
  }
}

/** Pure: ทั้ง 3 routes ยังไม่มี query contract; ปฏิเสธฟิลด์ที่ไม่รู้จักแทนการละเลย */
@Injectable()
export class EmptyTripQueryPipe extends EmptyQueryPipe {}

/** Pure: รวม Money แยกสกุลด้วย BigInt; ไม่ผ่าน Number และไม่รวมเงินต่างสกุลเข้าด้วยกัน */
export function totalsByCurrency(items: TripView[]): Money[] {
  return sumMoney(items.map((item) => item.total));
}
