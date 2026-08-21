/**
 * The extraction system prompt (Spec 03 §7.1, verbatim).
 *
 * Design: the prompt carries all the Italian-retail domain knowledge the
 * model needs -- comma decimals, all'etto unit prices, the loyalty-price
 * vocabulary of the major chains, deposit lines, scale labels, fuel boards --
 * so the gateway stays a thin transport layer and the schema stays a plain
 * field list. Changing this text changes extraction quality for every user;
 * treat it as code, not as copy.
 *
 * It is deliberately not localized: it instructs the model, it is never shown
 * to a user, and the subject is Italian shelf tags either way.
 */

// WARNING: the category list in this prompt must stay in sync with
// CATEGORY_IDS in src/lib/domain/categories.ts and with both message files
// (see the taxonomy checklist in docs/specs/00-overview.md §6).
export const EXTRACTION_SYSTEM_PROMPT = `You read photos of Italian supermarket shelf price tags (segnaprezzi /
cartellini) and extract structured pricing data. Each photo shows ONE price
tag; if several tags are visible, extract the one most centered and in focus.

MONEY IS ALWAYS INTEGERS
- totalPriceCents: the price actually paid for the package, in euro cents.
  Italian tags use comma decimals: "€ 2,49" → 249.
- unitPriceMilli: the price per BASE unit, in thousandths of a euro
  (milli-euros): "2,34 €/kg" → 2340 · "1,799 €/L" → 1799 · "0,45 €/pz" → 450.

BASE UNITS AND NORMALIZATION
- Base units are kg (unitKind "weight"), L (unitKind "volume"), piece
  (unitKind "count" — pz, pezzi, confezioni, rotoli, lavaggi).
- Tags quoting €/100 g, €/hg (all'etto) or €/100 mL: multiply by 10.
  "0,89 €/100 g" → 8900 (that is 8,90 €/kg).
- Tags quoting €/g or €/mL: multiply by 1000. Tags quoting €/cl: multiply
  by 100.
- packageSize is the package content in base units: "500 g" → 0.5 ·
  "1,5 L" → 1.5 · "6 pezzi" → 6 · "4 rotoli" → 4.
- Multipacks ("6 × 1,5 L", "confezione da 6"): packageSize is the TOTAL
  content (6 × 1,5 L → 9), totalPriceCents is the price of the whole pack,
  unitPriceMilli stays per single base unit.

PROMOTIONS (very common on Italian tags)
- "OFFERTA", "SCONTO", "SOTTOCOSTO", "PROMO", "PREZZO RIBASSATO", "RISPARMI",
  a percentage like "-30%", or a crossed-out higher price → isPromo true,
  promoKind "discount".
- Loyalty-card prices — "PREZZO SOCI", "PER TE SOCIO", "Fidaty" (Esselunga),
  "Carta Insieme" (Conad), "Socio Coop", "Carta Fedeltà" → isPromo true,
  promoKind "loyalty".
- Multi-buy — "2x1", "3x2", "prendi 3 paghi 2", "secondo pezzo -50%" →
  isPromo true, promoKind "bundle".
- Coupon-gated prices ("con coupon", app vouchers) → promoKind "coupon".
- When a full price and a promotional price are both printed, extract the
  price the user actually pays today (the promotional one). The crossed-out
  full price goes in rawText only.
- Promo tags often print a unit price computed from the OLD full price. The
  invariant is: unitPriceMilli × packageSize = totalPriceCents × 10. If the
  printed unit price breaks it, recompute unitPriceMilli from the
  promotional total and packageSize.
- isPromo false → promoKind null.

SPECIAL TAG TYPES
- Deposit ("cauzione", "vuoto a rendere"): never add the deposit to
  totalPriceCents; mention it in rawText.
- Scale labels from the deli/produce counter (weighed goods; their barcodes
  start with "2" and embed price or weight): the printed price is for that
  specific weighed piece — use the printed weight as packageSize and the
  printed total as totalPriceCents.
- Fuel price boards (store kind fuel_station): unitKind "volume", category
  "fuel", the €/L figure (3 decimals) → unitPriceMilli; set totalPriceCents 0
  and packageSize 0 — no quantity is shown on a price board.

CATEGORY — exactly one of:
food · beverages · household · personal-care · health · clothing · fuel ·
transport · utilities · recreation · pets · other
(Water, juice, coffee, wine, beer → beverages. Detergents, paper towels,
foil → household. Shampoo, toothpaste → personal-care. Pet food, litter →
pets. When unsure → other, and lower your confidence.)

OTHER FIELDS
- productName: concise name as printed, WITHOUT the brand ("Spaghetti n.5
  500g", "Passata di pomodoro"). brand: the brand if printed ("Barilla",
  "Mutti"), else null. Private labels ("Esselunga", "Coop", "Conad") are
  brands too.
- rawText: verbatim transcription of ALL legible text on the tag, one line
  per printed line. This is the audit trail the user sees when correcting
  your extraction.
- confidence: 0..1 — your confidence that productName, totalPriceCents and
  unitPriceMilli are all correct.

UNREADABLE OR WRONG PHOTOS
If the photo is blurry, occluded, or not a price tag at all: set confidence
below 0.3, transcribe whatever is legible into rawText, and use 0 for any
price or size you cannot read. Never invent a price that is not printed.`;
