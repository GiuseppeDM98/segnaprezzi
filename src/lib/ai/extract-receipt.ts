/**
 * Anthropic gateway: one receipt file in, one ReceiptExtraction out
 * (Spec 07 §6.3).
 *
 * Design: same client construction, same structured-output pattern and the
 * same AiGatewayError mapping as the price-tag gateway — imported from it
 * rather than duplicated, so there is exactly one place in the codebase that
 * knows how an SDK failure becomes a retryable/non-retryable domain error.
 *
 * A PDF goes to the API as a native `document` block: the API renders the
 * pages and reads their text layer itself, which is why this project needs
 * no PDF parsing library and no server-side rasterization.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import type { ReceiptMediaType } from '@/lib/domain/receipts';
import type { StoreKind } from '@/lib/domain/stores';
import { env } from '@/lib/env';
import { AiGatewayError, toAiGatewayError } from './extract-price-tag';
import { RECEIPT_SYSTEM_PROMPT } from './receipt-prompt';
import { type ReceiptExtraction, receiptExtractionSchema } from './receipt-schema';

/**
 * Locked to Haiku 4.5 (Spec 00 §3): this is transcription of text that is
 * already structured, and a 40-line receipt costs about two cents. Kept in
 * its own constant, separate from Spec 03's EXTRACTION_MODEL, so the tag and
 * receipt pipelines can diverge without one dragging the other along.
 */
export const RECEIPT_EXTRACTION_MODEL = 'claude-haiku-4-5';

/**
 * A whole receipt is a longer read than one tag: Spec 03's 30 s budget is
 * tuned for a single image, and a two-page PDF regularly needs more.
 */
const RECEIPT_TIMEOUT_MS = 45_000;

/** 60 lines × ~120 output tokens of JSON ≈ 7K; this leaves headroom. */
const RECEIPT_MAX_TOKENS = 8000;

/**
 * Its own SDK instance rather than Spec 03's: the two differ only in the
 * timeout, and a per-call `withOptions` would make the injected-client test
 * seam a different shape here than everywhere else in src/lib/ai.
 */
const receiptClient = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  timeout: RECEIPT_TIMEOUT_MS,
  // The route owns the retry decision (503 + Retry-After); an SDK retry on
  // top would multiply attempts and hold the serverless function open past
  // its budget.
  maxRetries: 0,
});

export type { ReceiptMediaType };

export interface ExtractReceiptInput {
  bytes: Uint8Array;
  mediaType: ReceiptMediaType;
  storeKind: StoreKind | null;
  chainHint: string | null;
}

/**
 * Read every product line off one receipt.
 *
 * @param input - The file bytes plus optional store hints for the prompt
 * @param client - Injected for tests; defaults to the shared SDK singleton
 * @returns The parsed extraction (schema-validated by the SDK)
 * @throws AiGatewayError for every failure mode, retryable flag set
 */
export async function extractReceipt(
  input: ExtractReceiptInput,
  client: Anthropic = receiptClient,
): Promise<ReceiptExtraction> {
  const data = Buffer.from(input.bytes).toString('base64');
  const fileBlock =
    input.mediaType === 'application/pdf'
      ? {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data,
          },
        }
      : {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: input.mediaType, data },
        };

  try {
    const response = await client.messages.parse({
      model: RECEIPT_EXTRACTION_MODEL,
      max_tokens: RECEIPT_MAX_TOKENS,
      // Temperature 0: transcription, not generation — the right answer is
      // fully determined by the document, and sampling variety only invents
      // transposed digits.
      temperature: 0,
      system: RECEIPT_SYSTEM_PROMPT,
      messages: [
        {
          // The document block goes BEFORE the text block, as the API
          // recommends for documents.
          role: 'user',
          content: [fileBlock, { type: 'text', text: buildReceiptInstruction(input) }],
        },
      ],
      output_config: { format: zodOutputFormat(receiptExtractionSchema) },
    });

    if (response.stop_reason === 'refusal') {
      throw new AiGatewayError('refused', false, 'Model refused to process the receipt');
    }
    // Why a hard failure rather than a partial success: a truncated line list
    // would silently drop the bottom of the receipt, and a half-imported
    // receipt is worse than none — the missing lines would never be noticed.
    if (response.stop_reason === 'max_tokens') {
      throw new AiGatewayError('malformed-output', false, 'Receipt output truncated');
    }
    if (!response.parsed_output) {
      throw new AiGatewayError(
        'malformed-output',
        false,
        `No parseable extraction (${response.stop_reason})`,
      );
    }
    return response.parsed_output;
  } catch (error) {
    throw toAiGatewayError(error);
  }
}

/** Store hints first, then the instruction — both are short and unambiguous. */
function buildReceiptInstruction(input: ExtractReceiptInput): string {
  const parts = ['Extract every product line from this receipt.'];
  if (input.chainHint) {
    parts.unshift(`Store chain: ${input.chainHint}.`);
  }
  if (input.storeKind) {
    parts.unshift(`Store kind: ${input.storeKind}.`);
  }
  return parts.join(' ');
}
