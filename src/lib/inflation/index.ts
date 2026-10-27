/**
 * Public API of the personal inflation engine.
 *
 * Consumers import from '@/lib/inflation' only. The sibling modules are
 * implementation details: importing one of them from outside this folder is
 * forbidden, and nothing beyond the functions and public types re-exported
 * below is part of the contract.
 */
export {
  computeMonthlyMeans,
  MAX_CARRY_FORWARD_MONTHS,
  type MonthlyMean,
  toRomeYearMonth,
} from './bucketing';
export { BASE_INDEX, computePersonalCpi } from './chain';
export { rebaseIstat } from './istat';
export type {
  CategorySeries,
  Coverage,
  Headline,
  IndexEntry,
  IndexProduct,
  IndexSettings,
  MonthPoint,
  PersonalCpiResult,
  ProductMover,
} from './types';
