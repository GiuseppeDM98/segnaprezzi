/**
 * Anthropic gateway: one photo in, one ExtractionResult out.
 *
 * Design: src/lib/ai/ is the only place that talks to the Anthropic API.
 * This gateway maps every failure mode onto AiGatewayError with an
 * isRetryable flag, so the service and the offline queue can share one retry
 * policy without knowing SDK internals. The services translate AiGatewayError
 * into ExtractionError / ExtractionUnavailableError, and the route layer
 * turns those into HTTP responses — AiGatewayError never reaches it.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import type { PhotoMediaType } from '@/lib/domain/photos';
import type { StoreKind } from '@/lib/domain/stores';
import { env } from '@/lib/env';
import { EXTRACTION_SYSTEM_PROMPT } from './extraction-prompt';
import { type ExtractionResult, extractionResultSchema } from './extraction-schema';

/**
 * Opus 5.5 rather than Haiku: a shelf tag is one dense image, and misread
 * digits are the failure that costs the most downstream (a wrong price is an
 * observation the index trusts). The per-call cost is a few cents.
 */
export const EXTRACTION_MODEL = 'claude-opus-5-5';

/**
 * Thinking is always on for this model and `effort` is the only control.
 * `high` buys the careful read of a photographed tag — glare, tiny unit
 * prices, two prices on one label — at a few extra seconds; the timeout
 * below is sized for it.
 */
const EXTRACTION_EFFORT = 'high' as const;

export type ExtractionFailureCode =
  | 'rate-limited'
  | 'timeout'
  | 'upstream-unavailable'
  | 'refused'
  | 'invalid-request'
  | 'malformed-output';

export class AiGatewayError extends Error {
  constructor(
    readonly failureCode: ExtractionFailureCode,
    readonly isRetryable: boolean,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AiGatewayError';
  }
}

/**
 * One image, one tag — but a model that thinks before it answers: a read at
 * `high` effort regularly takes 10–30 s, so the budget is a minute. The
 * route's `maxDuration` must outlive this.
 */
const PRICE_TAG_TIMEOUT_MS = 60_000;

/**
 * Thinking tokens count toward max_tokens even though their text is not
 * returned, so this is sized for the reasoning plus one JSON object with a
 * long transcribed rawText — not for the JSON alone.
 */
const PRICE_TAG_MAX_TOKENS = 8000;

const anthropicClient = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  timeout: PRICE_TAG_TIMEOUT_MS,
  // The offline queue owns the retry policy (attempts + backoff). Letting the
  // SDK also retry would multiply attempts and hold the serverless function
  // open past its budget.
  maxRetries: 0,
});

export interface ExtractPriceTagInput {
  /** The photo as uploaded; base64-encoded here. */
  bytes: Uint8Array;
  mediaType: PhotoMediaType;
  storeKind: StoreKind | null;
}

/**
 * Extract structured price-tag data from one photo.
 *
 * @param input - Photo bytes + optional store-kind hint for the prompt
 * @param client - Injected for tests; defaults to the module singleton
 * @returns The parsed extraction (schema-validated by the SDK)
 * @throws AiGatewayError for every failure mode, retryable flag set
 */
export async function extractPriceTag(
  input: ExtractPriceTagInput,
  client: Anthropic = anthropicClient,
): Promise<ExtractionResult> {
  const base64Data = Buffer.from(input.bytes).toString('base64');
  try {
    const response = await client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: PRICE_TAG_MAX_TOKENS,
      // No sampling parameters: this model rejects `temperature` outright,
      // and the prompt already frames the task as transcription.
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.mediaType,
                data: base64Data,
              },
            },
            { type: 'text', text: buildUserInstruction(input.storeKind) },
          ],
        },
      ],
      output_config: {
        effort: EXTRACTION_EFFORT,
        format: zodOutputFormat(extractionResultSchema),
      },
    });

    if (response.stop_reason === 'refusal') {
      throw new AiGatewayError('refused', false, 'Model refused to process the photo');
    }
    if (!response.parsed_output) {
      throw new AiGatewayError(
        'malformed-output',
        false,
        `No parseable extraction (stop_reason: ${response.stop_reason})`,
      );
    }
    return response.parsed_output;
  } catch (error) {
    throw toAiGatewayError(error);
  }
}

function buildUserInstruction(storeKind: ExtractPriceTagInput['storeKind']): string {
  const storeContext = storeKind ? `Store kind: ${storeKind}. ` : '';
  return `${storeContext}Extract the price tag data from this photo.`;
}

/**
 * Map SDK failures onto AiGatewayError. Order matters: most specific first.
 *
 * Kept as the one classification of SDK failures: any second gateway must
 * reuse it, or the offline queue's retry policy stops meaning one thing.
 */
export function toAiGatewayError(error: unknown): AiGatewayError {
  if (error instanceof AiGatewayError) {
    return error;
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiGatewayError('rate-limited', true, 'Anthropic rate limit', { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiGatewayError('timeout', true, 'Anthropic request timed out', { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiGatewayError('upstream-unavailable', true, 'Cannot reach Anthropic', {
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    // 5xx (incl. 529 overloaded) is Anthropic's problem — retry. Anything in
    // the 4xx range (bad request, auth misconfiguration) will fail identically
    // on retry, so fail fast and surface it.
    const isServerSide = typeof error.status === 'number' && error.status >= 500;
    return new AiGatewayError(
      isServerSide ? 'upstream-unavailable' : 'invalid-request',
      isServerSide,
      `Anthropic API error ${error.status}: ${error.message}`,
      { cause: error },
    );
  }
  return new AiGatewayError('malformed-output', false, 'Unexpected extraction failure', {
    cause: error,
  });
}
