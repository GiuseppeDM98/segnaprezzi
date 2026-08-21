import { describe, expect, it } from 'vitest';
import { NotFoundError, toActionError } from './errors';

describe('toActionError', () => {
  it('should map a DomainError to its code and message', () => {
    // Arrange
    const error = new NotFoundError('product', 'abc123');

    // Act
    const result = toActionError(error);

    // Assert
    expect(result).toEqual({ code: 'NOT_FOUND', message: 'product abc123 not found' });
  });

  it('should hide details when the error is not a DomainError', () => {
    // Arrange
    const error = new Error('libsql://user:secret@host connection refused');

    // Act
    const result = toActionError(error);

    // Assert
    expect(result.code).toBe('INTERNAL');
    expect(result.message).not.toContain('secret');
  });
});
