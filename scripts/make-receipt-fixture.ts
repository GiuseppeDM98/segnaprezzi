/**
 * Generate the synthetic receipt PDF the E2E suite uploads.
 *
 * Why generated rather than committed as an opaque binary: a real receipt
 * must never enter this repository (it carries a real store, a real date, a
 * loyalty number and somebody's actual shopping), and a hand-made fixture
 * that nobody can read or regenerate rots. This writes a minimal, fully
 * legible PDF — the same bytes every run, so its SHA-256 is stable and the
 * idempotency test can rely on it.
 *
 * The invented product names ("fenicottero", "ornitorinco", "quokka") are
 * the collaudo "parole spia" of WORKFLOW.md: they cannot collide with seeded
 * or real data, so a fixture row is always recognisable as one.
 *
 * Run: pnpm tsx scripts/make-receipt-fixture.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUTPUT_PATH = join('tests', 'e2e', 'fixtures', 'receipt-coop-sample.pdf');

/**
 * The printed lines, in receipt order. They mirror the extraction the E2E
 * helper seeds, so what the tester sees in the PDF is what the review screen
 * shows.
 */
export const RECEIPT_LINES = [
  'COOP VIA FENICOTTERO 12',
  'MILANO',
  '',
  'SCONTRINO N. 0042    19/08/2026 18:42',
  '',
  'PASTA FENICOTTERO N5 500G      1,29',
  'LATTE ORNITORINCO 1L   2 x 1,09  2,18',
  'SCONTO SOCI                   -0,40',
  'QUOKKA FRESCO A PESO             3,10',
  'IMPOSTA SACCHETTO                0,03',
  '',
  'TOTALE COMPLESSIVO               6,20',
  'CONTANTI                        10,00',
  'RESTO                            3,80',
];

/** Escape the three characters a PDF literal string cannot carry raw. */
function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** A Courier text block, one line per printed row, top-down. */
function buildContentStream(lines: string[]): string {
  const body = lines
    .map((line, index) => `1 0 0 1 20 ${360 - index * 18} Tm (${escapePdfText(line)}) Tj`)
    .join('\n');
  return `BT\n/F1 9 Tf\n${body}\nET\n`;
}

/**
 * Assemble a minimal single-page PDF with a real cross-reference table.
 *
 * Hand-rolled on purpose: this repository has no PDF dependency (Spec 07 §6
 * — the Anthropic API reads PDFs itself), and adding one to write a
 * fourteen-line test fixture would be the tail wagging the dog.
 */
function buildPdf(lines: string[]): Buffer {
  const content = buildContentStream(lines);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

const pdf = buildPdf(RECEIPT_LINES);
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, pdf);

console.log(`Wrote ${OUTPUT_PATH} (${pdf.byteLength} bytes)`);
console.log(`sha256: ${createHash('sha256').update(pdf).digest('hex')}`);
