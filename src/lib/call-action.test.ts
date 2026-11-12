import { afterEach, describe, expect, test, vi } from 'vitest';

import { callAction, describeActionError } from './call-action';

describe('callAction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('should pass a successful result through unchanged', async () => {
    // Arrange
    const call = Promise.resolve({ ok: true as const, data: { id: 'product-1' } });

    // Act
    const result = await callAction('createProduct', call);

    // Assert
    expect(result).toEqual({ ok: true, data: { id: 'product-1' } });
  });

  test('should pass a failed result through unchanged', async () => {
    // Arrange
    const call = Promise.resolve({
      ok: false as const,
      error: { code: 'PRODUCT_NOT_FOUND' as const, message: 'Product x not found' },
    });

    // Act
    const result = await callAction('updateProduct', call);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: { code: 'PRODUCT_NOT_FOUND', message: 'Product x not found' },
    });
  });

  test('should turn a rejected request into an INTERNAL failure and log it', async () => {
    // Arrange
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new TypeError('Failed to fetch');

    // Act
    const result = await callAction('deleteProduct', Promise.reject(cause));

    // Assert
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Action request failed' },
    });
    expect(log).toHaveBeenCalledWith('deleteProduct request failed', { cause });
  });
});

describe('describeActionError', () => {
  const translateError = (code: string): string => `errors.${code}`;

  test('should show the translated cause for a known error code', () => {
    // Act
    const message = describeActionError(
      { code: 'PRODUCT_NOT_FOUND', message: 'dev text' },
      translateError,
      'Not saved',
    );

    // Assert
    expect(message).toBe('errors.PRODUCT_NOT_FOUND');
  });

  test('should show the screen fallback for an INTERNAL error', () => {
    // Act
    const message = describeActionError(
      { code: 'INTERNAL', message: 'Unexpected error' },
      translateError,
      'Not saved',
    );

    // Assert
    expect(message).toBe('Not saved');
  });
});
