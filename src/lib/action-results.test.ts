import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from 'next/cache';
import { fieldErrorResult, invalidInputResult, revalidateAppLayout } from './action-results';

function zodErrorOf(schema: z.ZodType, input: unknown): z.ZodError {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    throw new Error('expected the input to fail');
  }
  return parsed.error;
}

describe('invalidInputResult', () => {
  test('should report INVALID_INPUT with the Zod message', () => {
    // Arrange
    const error = zodErrorOf(z.object({ storeId: z.string() }), {});

    // Act
    const result = invalidInputResult(error);

    // Assert
    expect(result).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: error.message } });
  });
});

describe('fieldErrorResult', () => {
  test('should report the code of the failing price field', () => {
    // Arrange
    const error = zodErrorOf(z.object({ totalPriceCents: z.number().min(1) }), {
      totalPriceCents: 0,
    });

    // Act
    const result = fieldErrorResult(error);

    // Assert
    expect(result).toEqual({ ok: false, error: { code: 'INVALID_PRICE', message: error.message } });
  });

  test('should fall back to INVALID_INPUT for a field with no code of its own', () => {
    // Arrange
    const error = zodErrorOf(z.object({ name: z.string().min(1) }), { name: '' });

    // Act
    const result = fieldErrorResult(error);

    // Assert
    expect(result.ok === false && result.error.code).toBe('INVALID_INPUT');
  });
});

describe('revalidateAppLayout', () => {
  test('should revalidate the whole locale layout', () => {
    // Act
    revalidateAppLayout();

    // Assert
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]', 'layout');
  });
});
