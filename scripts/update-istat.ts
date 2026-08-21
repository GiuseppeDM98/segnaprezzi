/**
 * Refresh data/istat-nic.json from ISTAT's SDMX REST service (Spec 04 §8.2).
 *
 * Run with `pnpm istat:update`. This is a maintenance script, not app code —
 * it may do I/O freely, but it fails fast, loud and diagnosable, and it never
 * writes anything on failure. Three rules from the spec:
 *   1. Validate hard: any surprise in the response aborts with a diagnostic
 *      (URL, status, first bytes of the body) and exit code 1.
 *   2. Replace, don't merge: `months` is rebuilt from the full fetched series
 *      on every run — ISTAT revises provisional figures, and full replacement
 *      self-heals past revisions.
 *   3. Atomic write: serialize the whole file, write it next to the target,
 *      then rename over it. A crash mid-write never leaves a truncated
 *      committed file.
 *
 * Why this endpoint (verified 2026-08-21 against the live service): the
 * dataflow family Spec 04 names, `IT1,167_744,1.0` ("Nic - monthly data from
 * 2016 onwards, base 2015"), is frozen at 2025-12 — ISTAT rebased the NIC to
 * 2025=100 in January 2026 and opened `IT1,167_745,1.0` ("Nic - monthly data
 * from 2026 onwards, base 2025"). That newer dataflow also serves, under
 * distinct DATA_TYPE codes, the three historical bases (1995, 2010, 2015),
 * back to 1996, with no gaps and no overlaps between them. So one query —
 * key `M.IT..4.00` = monthly, Italy, every index-number DATA_TYPE, MEASURE 4
 * "index number", ECOICOP_2 "00" all items — returns the complete history,
 * which scripts/istat-nic.ts chain-links into one series in the newest base.
 * Verify the flowRef with `…/rest/dataflow/IT1?detail=allstubs` (the full
 * catalogue is ~2 MB of XML; filter the names for "Nic") if this ever 404s.
 *
 * Why `Accept: application/json` instead of the spec's `?format=jsondata`:
 * on this NSI version `format=jsondata` (and the SDMX-JSON 2.0 media type)
 * return the series with every observation `null`; the SDMX-JSON 1.0 shape
 * negotiated through `application/json` returns real values.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  decodeBaseSeries,
  describeBase,
  type IstatNicFile,
  IstatUpdateError,
  linkBases,
  type SdmxJsonDataMessage,
  serializeIstatNicFile,
} from './istat-nic';

const DATAFLOW = 'IT1,167_745,1.0';
const SERIES_KEY = 'M.IT..4.00';
const ISTAT_DATA_URL = `https://esploradati.istat.it/SDMXWS/rest/data/${DATAFLOW}/${SERIES_KEY}`;
const OUTPUT_PATH = join(process.cwd(), 'data', 'istat-nic.json');
const FETCH_TIMEOUT_MS = 120_000;

async function fetchSdmxJson(url: string): Promise<SdmxJsonDataMessage> {
  let response: Response;
  try {
    response = await fetch(url, {
      // Why an explicit Accept-Language: Node's fetch (undici) sends
      // `accept-language: *` by default, and the NSI web service answers that
      // with HTTP 500 "languageTag1" — it cannot parse `*` as a language tag.
      headers: { Accept: 'application/json', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new IstatUpdateError('request failed', { url, error: String(error) });
  }

  const body = await response.text();
  if (!response.ok) {
    throw new IstatUpdateError('non-200 response', {
      url,
      status: response.status,
      body: body.slice(0, 500),
    });
  }
  try {
    return JSON.parse(body) as SdmxJsonDataMessage;
  } catch (error) {
    throw new IstatUpdateError('unparseable JSON body', {
      url,
      error: String(error),
      body: body.slice(0, 500),
    });
  }
}

function writeAtomically(path: string, serialized: string): void {
  const temporaryPath = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporaryPath, serialized, 'utf8');
  renameSync(temporaryPath, path);
}

async function main(): Promise<void> {
  const message = await fetchSdmxJson(ISTAT_DATA_URL);
  const bases = decodeBaseSeries(message);
  const linked = linkBases(bases);

  const file: IstatNicFile = {
    source: `ISTAT SDMX REST (esploradati.istat.it), dataflow ${DATAFLOW}, key ${SERIES_KEY}`,
    indexName: 'NIC all items',
    base: describeBase(bases),
    updatedAt: new Date().toISOString(),
    months: Object.fromEntries(linked.months),
  };
  writeAtomically(OUTPUT_PATH, serializeIstatNicFile(file));

  const sortedMonths = [...linked.months.keys()].sort();
  console.log(
    `update-istat: wrote ${sortedMonths.length} months (${sortedMonths[0]} … ${sortedMonths[sortedMonths.length - 1]}), base ${linked.baseYear}=100, to ${OUTPUT_PATH}`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof IstatUpdateError) {
    console.error(`update-istat: ${error.message}`);
    for (const [key, value] of Object.entries(error.details)) {
      console.error(`  ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
  } else {
    console.error('update-istat: unexpected error', error);
  }
  process.exit(1);
});
