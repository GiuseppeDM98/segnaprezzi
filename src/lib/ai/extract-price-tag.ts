/**
 * Anthropic gateway: one photo in, one ExtractionResult out.
 *
 * Design: this module is the only place that talks to the Anthropic API.
 * It maps every failure mode onto AiGatewayError (internal to src/lib/ai/)
 * with an isRetryable flag, so the service and the offline queue can share
 * one retry policy without knowing SDK internals. The service/route layer
 * translates AiGatewayError into the app's ExtractionError / HTTP responses.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { env } from '@/lib/env';
import { EXTRACTION_SYSTEM_PROMPT } from './extraction-prompt';
import { type ExtractionResult, extractionResultSchema } from './extraction-schema';

export const EXTRACTION_MODEL = 'claude-haiku-4-5';

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

const anthropicClient = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  timeout: 30_000,
  // The offline queue owns the retry policy (attempts + backoff). Letting the
  // SDK also retry would multiply attempts and hold the serverless function
  // open past its budget.
  maxRetries: 0,
});

export interface ExtractPriceTagInput {
  imageBase64: string;
  mediaType: 'image/webp' | 'image/jpeg';
  storeKind: 'supermarket' | 'fuel_station' | 'other' | null;
}

/**
 * Extract structured price-tag data from one photo.
 *
 * @param input - Base64 photo + optional store-kind hint for the prompt
 * @param client - Injected for tests; defaults to the module singleton
 * @returns The parsed extraction (schema-validated by the SDK)
 * @throws AiGatewayError for every failure mode, retryable flag set
 */
export async function extractPriceTag(
  input: ExtractPriceTagInput,
  client: Anthropic = anthropicClient,
): Promise<ExtractionResult> {
  try {
    const response = await client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: 1500,
      // Temperature 0: this is transcription, not generation — the correct
      // output is fully determined by the pixels, and sampling variety only
      // adds transposed digits. It also makes retries reproducible.
      temperature: 0,
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
                data: input.imageBase64,
              },
            },
            { type: 'text', text: buildUserInstruction(input.storeKind) },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(extractionResultSchema) },
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
 * Exported for the receipt gateway, which must classify the same failures
 * the same way — the offline queue and the receipt route share one retry
 * policy precisely because they share this function.
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
