import Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AiGatewayError } from './extract-price-tag';
import { extractReceipt, RECEIPT_EXTRACTION_MODEL } from './extract-receipt';
import type { ReceiptExtraction } from './receipt-schema';

/*
 * The gateway is mocked at the SDK client boundary, like Spec 03's: the
 * point of these tests is the request shape and the failure-mode mapping,
 * and every branch of the latter keys off a real SDK error class — so the
 * fixtures construct the real classes rather than lookalike objects, or the
 * instanceof chain under test would never run.
 */

const parse = vi.fn();
const mockClient = { messages: { parse } } as unknown as Anthropic;

const VALID_EXTRACTION: ReceiptExtraction = {
  storeChain: 'Coop',
  storeName: 'Coop Via Roma',
  purchasedAt: '2026-08-19T18:42:00',
  receiptTotalCents: 431,
  confidence: 0.92,
  lines: [
    {
      rawLine: 'PASTA BAR SPAGH N5 500G          1,29',
      description: 'Spaghetti n.5 500g',
      brand: 'Barilla',
      category: 'food',
      quantity: 1,
      quantityKind: 'pieces',
      unitPriceCentsOnReceipt: null,
      lineTotalCents: 129,
      discountCents: 0,
      packageSizeHint: 0.5,
      unitKindHint: 'weight',
      isPromo: false,
      promoKind: null,
      confidence: 0.95,
    },
  ],
};

const PDF_INPUT = {
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  mediaType: 'application/pdf' as const,
  storeKind: null,
  chainHint: null,
};

function apiErrorBody(type: string) {
  return { type: 'error', error: { type, message: 'x' } };
}

beforeEach(() => {
  parse.mockReset();
});

describe('extractReceipt', () => {
  test('should return the parsed extraction on a successful call', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: VALID_EXTRACTION });

    const result = await extractReceipt(PDF_INPUT, mockClient);

    expect(result).toEqual(VALID_EXTRACTION);
  });

  test('should send a PDF as a base64 document block to the locked model', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: VALID_EXTRACTION });

    await extractReceipt(PDF_INPUT, mockClient);

    const params = parse.mock.calls[0][0];
    expect(params.model).toBe(RECEIPT_EXTRACTION_MODEL);
    expect(RECEIPT_EXTRACTION_MODEL).toBe('claude-haiku-4-5');
    expect(params.temperature).toBe(0);
    expect(params.max_tokens).toBe(8000);
    expect(params.output_config.format).toBeDefined();
    expect(params.messages[0].content[0]).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERg==' },
    });
    // The document block goes before the text instruction (API guidance).
    expect(params.messages[0].content[1].type).toBe('text');
  });

  test('should send a photo as an image block', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: VALID_EXTRACTION });

    await extractReceipt({ ...PDF_INPUT, mediaType: 'image/webp' }, mockClient);

    expect(parse.mock.calls[0][0].messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/webp' },
    });
  });

  test('should put the store hints in front of the instruction', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: VALID_EXTRACTION });

    await extractReceipt({ ...PDF_INPUT, storeKind: 'supermarket', chainHint: 'Coop' }, mockClient);

    expect(parse.mock.calls[0][0].messages[0].content[1].text).toBe(
      'Store kind: supermarket. Store chain: Coop. Extract every product line from this receipt.',
    );
  });

  test('should treat a truncated output as a hard failure', async () => {
    // A partial line list would silently drop the bottom of the receipt.
    parse.mockResolvedValue({ stop_reason: 'max_tokens', parsed_output: VALID_EXTRACTION });

    const error = await extractReceipt(PDF_INPUT, mockClient).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(AiGatewayError);
    expect(error.failureCode).toBe('malformed-output');
    expect(error.isRetryable).toBe(false);
  });

  test('should map a refusal to a non-retryable gateway error', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal', parsed_output: null });

    const error = await extractReceipt(PDF_INPUT, mockClient).catch((thrown) => thrown);

    expect(error.failureCode).toBe('refused');
    expect(error.isRetryable).toBe(false);
  });

  test('should map a missing parsed output to malformed-output', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: null });

    const error = await extractReceipt(PDF_INPUT, mockClient).catch((thrown) => thrown);

    expect(error.failureCode).toBe('malformed-output');
  });

  test('should map an overloaded upstream (529) to a retryable gateway error', async () => {
    parse.mockRejectedValue(
      new Anthropic.APIError(529, apiErrorBody('overloaded_error'), 'overloaded', new Headers()),
    );

    const error = await extractReceipt(PDF_INPUT, mockClient).catch((thrown) => thrown);

    expect(error.failureCode).toBe('upstream-unavailable');
    expect(error.isRetryable).toBe(true);
  });

  test('should map a connection timeout to a retryable gateway error', async () => {
    parse.mockRejectedValue(new Anthropic.APIConnectionTimeoutError({ message: 'timed out' }));

    const error = await extractReceipt(PDF_INPUT, mockClient).catch((thrown) => thrown);

    expect(error.failureCode).toBe('timeout');
    expect(error.isRetryable).toBe(true);
  });

  test('should map a 400 to a non-retryable gateway error', async () => {
    parse.mockRejectedValue(
      new Anthropic.APIError(400, apiErrorBody('invalid_request_error'), 'bad', new Headers()),
    );

    const error = await extractReceipt(PDF_INPUT, mockClient).catch((thrown) => thrown);

    expect(error.failureCode).toBe('invalid-request');
    expect(error.isRetryable).toBe(false);
  });
});
