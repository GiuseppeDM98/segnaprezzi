/**
 * Public API of the personal inflation engine (Spec 04 §2).
 *
 * Consumers import from '@/lib/inflation' only. The sibling modules are
 * implementation details: importing one of them from outside this folder is
 * forbidden, and nothing beyond the three functions and the public types
 * below is part of the contract.
 */
export { toRomeYearMonth } from './bucketing';
export { computePersonalCpi } from './chain';
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
