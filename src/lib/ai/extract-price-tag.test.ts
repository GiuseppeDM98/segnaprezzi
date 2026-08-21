import Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AiGatewayError, EXTRACTION_MODEL, extractPriceTag } from './extract-price-tag';
import type { ExtractionResult } from './extraction-schema';

/*
 * The gateway is mocked at the SDK client boundary: the point of these tests
 * is the failure-mode mapping, and every branch of it keys off a real SDK
 * error class — so the fixtures construct the real classes rather than
 * lookalike objects, or the instanceof chain under test would never run.
 */

const parse = vi.fn();
const mockClient = { messages: { parse } } as unknown as Anthropic;

const VALID_EXTRACTION: ExtractionResult = {
  productName: 'Spaghetti n.5 500g',
  brand: 'Barilla',
  category: 'food',
  unitKind: 'weight',
  totalPriceCents: 89,
  packageSize: 0.5,
  unitPriceMilli: 1780,
  isPromo: false,
  promoKind: null,
  confidence: 0.93,
  rawText: 'Spaghetti n.5 500g\n0,89 €\n1,78 €/kg',
};

const INPUT = {
  imageBase64: 'aGVsbG8=',
  mediaType: 'image/webp' as const,
  storeKind: null,
};

function apiErrorBody(type: string) {
  return { type: 'error', error: { type, message: 'x' } };
}

beforeEach(() => {
  parse.mockReset();
});

describe('extractPriceTag', () => {
  test('should return the parsed extraction on a successful call', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: VALID_EXTRACTION });

    const result = await extractPriceTag(INPUT, mockClient);

    expect(result).toEqual(VALID_EXTRACTION);
  });

  test('should call the locked model with deterministic settings and the image block', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: VALID_EXTRACTION });

    await extractPriceTag(INPUT, mockClient);

    const params = parse.mock.calls[0][0];
    expect(params.model).toBe(EXTRACTION_MODEL);
    expect(EXTRACTION_MODEL).toBe('claude-haiku-4-5');
    expect(params.temperature).toBe(0);
    expect(params.max_tokens).toBe(1500);
    expect(params.output_config.format).toBeDefined();
    expect(params.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/webp', data: 'aGVsbG8=' },
    });
  });

  test('should pass the store kind hint to the model', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: VALID_EXTRACTION });

    await extractPriceTag({ ...INPUT, storeKind: 'fuel_station' }, mockClient);

    const params = parse.mock.calls[0][0];
    expect(params.messages[0].content[1].text).toContain('Store kind: fuel_station');
  });

  test('should map a refusal to a non-retryable gateway error', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal', parsed_output: null });

    const error = await extractPriceTag(INPUT, mockClient).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(AiGatewayError);
    expect(error.failureCode).toBe('refused');
    expect(error.isRetryable).toBe(false);
  });

  test('should map a missing parsed output to malformed-output', async () => {
    parse.mockResolvedValue({ stop_reason: 'max_tokens', parsed_output: null });

    const error = await extractPriceTag(INPUT, mockClient).catch((thrown) => thrown);

    expect(error.failureCode).toBe('malformed-output');
    expect(error.isRetryable).toBe(false);
  });

  test('should map a rate limit to a retryable gateway error', async () => {
    parse.mockRejectedValue(
      new Anthropic.RateLimitError(429, apiErrorBody('rate_limit_error'), 'x', new Headers()),
    );

    const error = await extractPriceTag(INPUT, mockClient).catch((thrown) => thrown);

    expect(error.failureCode).toBe('rate-limited');
    expect(error.isRetryable).toBe(true);
  });

  test('should map a connection timeout to a retryable gateway error', async () => {
    parse.mockRejectedValue(new Anthropic.APIConnectionTimeoutError({ message: 'timed out' }));

    const error = await extractPriceTag(INPUT, mockClient).catch((thrown) => thrown);

    expect(error.failureCode).toBe('timeout');
    expect(error.isRetryable).toBe(true);
  });

  test('should map an overloaded upstream (529) to a retryable gateway error', async () => {
    parse.mockRejectedValue(
      new Anthropic.APIError(529, apiErrorBody('overloaded_error'), 'overloaded', new Headers()),
    );

    const error = await extractPriceTag(INPUT, mockClient).catch((thrown) => thrown);

    expect(error.failureCode).toBe('upstream-unavailable');
    expect(error.isRetryable).toBe(true);
  });

  test('should map a bad request to a non-retryable gateway error', async () => {
    parse.mockRejectedValue(
      new Anthropic.BadRequestError(
        400,
        apiErrorBody('invalid_request_error'),
        'bad',
        new Headers(),
      ),
    );

    const error = await extractPriceTag(INPUT, mockClient).catch((thrown) => thrown);

    expect(error.failureCode).toBe('invalid-request');
    expect(error.isRetryable).toBe(false);
  });

  test('should wrap an unknown failure and keep its cause', async () => {
    const cause = new Error('boom');
    parse.mockRejectedValue(cause);

    const error = await extractPriceTag(INPUT, mockClient).catch((thrown) => thrown);

    expect(error.failureCode).toBe('malformed-output');
    expect(error.isRetryable).toBe(false);
    expect(error.cause).toBe(cause);
  });
});
