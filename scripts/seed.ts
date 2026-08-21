/**
 * Deterministic dev seed (Spec 02 §8). Gives Specs 04/05 a realistic
 * fourteen-month dataset (rising prices, promos, fuel, a second supermarket
 * for per-store comparison) plus a second, minimal user for cross-user
 * isolation testing (§8.4). Fourteen months, not four: Spec 05's dashboard
 * leads with the year-over-year headline and a 12-month trend, and both
 * need thirteen months of series to be real rather than a placeholder.
 *
 * Design: structured as small pure builder functions (buildSeedMonths,
 * buildGroceryEntries, buildFuelEntries) plus one writer that inserts via
 * the repository layer for price_entries — the seed doubles as an
 * end-to-end smoke test of that layer. Stores/products/sessions use fixed
 * ids for reproducibility and cross-references between builders, which the
 * repository create functions deliberately don't accept (Spec 02 §6.1: ids
 * are always app-generated) — those three tables are inserted directly via
 * the Drizzle schema instead.
 */
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db/client';
import {
  type CreatePriceEntryInput,
  createPriceEntries,
} from '@/lib/db/repositories/price-entries';
import { products, shoppingSessions, stores } from '@/lib/db/schema/app';
import { users } from '@/lib/db/schema/auth';
import { env } from '@/lib/env';
import { seedId } from './seed-ids';
import { SEED_USER, SEED_USER_2 } from './seed-users';

// Why: seeding must be impossible against production. The remote Turso URL
// starts with libsql://; only a local file database is accepted.
if (!process.env.TURSO_DATABASE_URL?.startsWith('file:')) {
  console.error('Refusing to seed: TURSO_DATABASE_URL is not a local file database.');
  process.exit(1);
}

if (!env.SIGNUP_ENABLED) {
  console.error('Refusing to seed: SIGNUP_ENABLED is false. Seeding creates users via signup.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Month calculation (Europe/Rome), computed at run time.
// ---------------------------------------------------------------------------

interface YearMonth {
  year: number;
  month: number; // 1-12
}

const romeYearMonthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
});

const romeOffsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Rome',
  timeZoneName: 'shortOffset',
});

function getCurrentRomeYearMonth(): YearMonth {
  const parts = romeYearMonthFormatter.formatToParts(new Date());
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value),
    month: Number(parts.find((p) => p.type === 'month')?.value),
  };
}

function subtractMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const totalMonths = year * 12 + (month - 1) - delta;
  return { year: Math.floor(totalMonths / 12), month: (totalMonths % 12) + 1 };
}

/** Minutes east of UTC for Europe/Rome at a given approximate instant (handles CET/CEST). */
function getRomeOffsetMinutes(approxUtcMs: number): number {
  const offsetPart = romeOffsetFormatter
    .formatToParts(new Date(approxUtcMs))
    .find((p) => p.type === 'timeZoneName')?.value;
  const match = offsetPart?.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!match) {
    return 60; // Fallback: CET.
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

/** Build a Date for a given local wall-clock time in Europe/Rome. */
function romeDateTime(ym: YearMonth, day: number, hour: number, minute: number): Date {
  const naiveGuessUtc = Date.UTC(ym.year, ym.month - 1, day, hour, minute) - 60 * 60_000;
  const offsetMinutes = getRomeOffsetMinutes(naiveGuessUtc);
  return new Date(Date.UTC(ym.year, ym.month - 1, day, hour, minute) - offsetMinutes * 60_000);
}

/** Number of seeded months: M-13 … M0 (current month). */
const SEED_MONTH_COUNT = 14;

/** The seed months, oldest first: M-13 … M0 (current month). */
function buildSeedMonths(): YearMonth[] {
  const current = getCurrentRomeYearMonth();
  return Array.from({ length: SEED_MONTH_COUNT }, (_, index) =>
    subtractMonths(current, SEED_MONTH_COUNT - 1 - index),
  );
}

// ---------------------------------------------------------------------------
// Fixed reference data (§8.3, §8.4).
// ---------------------------------------------------------------------------

const STORE_ESSELUNGA = {
  id: seedId('seed-store-esselunga'),
  name: 'Esselunga Viale Papiniano',
  chain: 'Esselunga',
  city: 'Milano',
  kind: 'supermarket' as const,
};

const STORE_ENI = {
  id: seedId('seed-store-eni'),
  name: 'Eni Station Via Lorenteggio',
  chain: 'Eni',
  city: 'Milano',
  kind: 'fuel_station' as const,
};

/** A second supermarket so the per-store comparison (Spec 05 §5.7) has two rows. */
const STORE_CARREFOUR = {
  id: seedId('seed-store-carrefour'),
  name: 'Carrefour Market Corso Genova',
  chain: 'Carrefour',
  city: 'Milano',
  kind: 'supermarket' as const,
};

type PromoKind = 'discount' | 'loyalty' | 'coupon' | 'bundle';

interface GroceryProductDef {
  id: string;
  name: string;
  brand: string | null;
  category: (typeof products.$inferInsert)['category'];
  unitKind: (typeof products.$inferInsert)['unitKind'];
  packageSize: number;
  /** unit_price_milli for [M-13 … M0], oldest first; the last four match Spec 02 §8.3. */
  prices: number[];
  /** spaghetti and latte get a second entry on day 18. */
  secondEntryDay18?: boolean;
  /** Month indexes (0 = M-13 … 13 = M0) with a promo entry, and their kind. */
  promos?: Array<{ monthIndex: number; kind: PromoKind }>;
  /** Month index whose entry should be source='photo' instead of 'manual'. */
  photoMonthIndex?: number;
  /** unit_price_milli at Carrefour for [M-1, M0], when the product is also bought there. */
  carrefourPrices?: [number, number];
}

const GROCERY_PRODUCTS: GroceryProductDef[] = [
  {
    id: seedId('seed-prod-spaghetti'),
    name: 'Spaghetti n.5 500g',
    brand: 'Barilla',
    category: 'food',
    unitKind: 'weight',
    packageSize: 0.5,
    prices: [2380, 2380, 2380, 2480, 2480, 2480, 2580, 2580, 2580, 2580, 2580, 2580, 2780, 2780],
    secondEntryDay18: true,
    photoMonthIndex: 13,
    carrefourPrices: [2690, 2690],
  },
  {
    id: seedId('seed-prod-latte'),
    name: 'Latte intero UHT 1L',
    brand: 'Granarolo',
    category: 'food',
    unitKind: 'volume',
    packageSize: 1.0,
    prices: [1590, 1590, 1590, 1650, 1650, 1650, 1690, 1690, 1690, 1690, 1690, 1750, 1750, 1790],
    secondEntryDay18: true,
    carrefourPrices: [1790, 1850],
  },
  {
    id: seedId('seed-prod-olio'),
    name: 'Olio extravergine di oliva 1L',
    brand: 'Monini',
    category: 'food',
    unitKind: 'volume',
    packageSize: 1.0,
    prices: [7990, 7990, 8490, 8490, 8490, 8990, 8990, 8990, 8990, 8990, 8990, 9490, 9490, 8990],
    promos: [{ monthIndex: 13, kind: 'loyalty' }],
    photoMonthIndex: 13,
    carrefourPrices: [9290, 9290],
  },
  {
    id: seedId('seed-prod-pane'),
    name: 'Pane casereccio',
    brand: null,
    category: 'food',
    unitKind: 'weight',
    packageSize: 0.5,
    prices: [3980, 3980, 3980, 4180, 4180, 4180, 4180, 4380, 4380, 4380, 4380, 4380, 4580, 4580],
  },
  {
    id: seedId('seed-prod-parmigiano'),
    name: 'Parmigiano Reggiano 24 mesi',
    brand: null,
    category: 'food',
    unitKind: 'weight',
    packageSize: 0.3,
    prices: [
      18900, 18900, 18900, 19400, 19400, 19400, 19400, 19900, 19900, 19900, 19900, 20500, 20500,
      21200,
    ],
  },
  {
    id: seedId('seed-prod-caffe'),
    name: 'Caffè macinato Qualità Rossa 250g',
    brand: 'Lavazza',
    category: 'food',
    unitKind: 'weight',
    packageSize: 0.25,
    prices: [
      13960, 13960, 13960, 14560, 14560, 12960, 14560, 15160, 15160, 15160, 15160, 15160, 13960,
      15960,
    ],
    promos: [
      { monthIndex: 5, kind: 'discount' },
      { monthIndex: 12, kind: 'discount' },
    ],
  },
  {
    id: seedId('seed-prod-acqua'),
    name: 'Acqua naturale 6×1.5L',
    brand: 'San Benedetto',
    category: 'beverages',
    unitKind: 'volume',
    packageSize: 9.0,
    prices: [270, 270, 270, 270, 290, 290, 290, 290, 290, 290, 290, 290, 312, 312],
  },
  {
    id: seedId('seed-prod-succo'),
    name: "Succo d'arancia 1L",
    brand: 'Yoga',
    category: 'beverages',
    unitKind: 'volume',
    packageSize: 1.0,
    prices: [1890, 1890, 1890, 1890, 1990, 1990, 1990, 1990, 1990, 1990, 1990, 1990, 2090, 2090],
  },
  {
    id: seedId('seed-prod-piatti'),
    name: 'Detersivo piatti limone 900ml',
    brand: 'Nelsen',
    category: 'household',
    unitKind: 'volume',
    packageSize: 0.9,
    prices: [1890, 1890, 1890, 1990, 1990, 1990, 1990, 1990, 1990, 1990, 1990, 2100, 2100, 2100],
  },
  {
    id: seedId('seed-prod-carta'),
    name: 'Carta igienica 4 rotoli',
    brand: 'Regina',
    category: 'household',
    unitKind: 'count',
    packageSize: 4,
    prices: [599, 599, 599, 599, 623, 623, 623, 623, 623, 623, 623, 623, 675, 675],
  },
  {
    id: seedId('seed-prod-shampoo'),
    name: 'Shampoo antiforfora 250ml',
    brand: 'H&S',
    category: 'personal-care',
    unitKind: 'volume',
    packageSize: 0.25,
    prices: [
      14960, 14960, 14960, 14960, 15960, 15960, 15960, 15960, 15960, 15960, 15960, 15960, 17160,
      17160,
    ],
  },
  {
    id: seedId('seed-prod-crocchette'),
    name: 'Croccantini gatto salmone 2kg',
    brand: 'Purina',
    category: 'pets',
    unitKind: 'weight',
    packageSize: 2.0,
    prices: [4495, 4495, 4495, 4495, 4495, 4745, 4745, 4745, 4745, 4745, 4745, 4745, 4995, 4995],
  },
];

const FUEL_PRODUCT = {
  id: seedId('seed-prod-benzina'),
  // Must match FUEL_QUICK_PICKS' canonical name, or a real refuelling would
  // create a second product and split this history in two (Spec 03 §11.1).
  name: 'Benzina',
  brand: null as string | null,
  category: 'fuel' as const,
  unitKind: 'volume' as const,
  /** unit_price_milli for [M-13 … M0]; the last four match Spec 02 §8.3. */
  prices: [1699, 1712, 1735, 1760, 1748, 1770, 1795, 1810, 1802, 1780, 1789, 1812, 1846, 1799],
};

/** Liters per fuel entry, consumed two at a time (one per month, cycling). */
const FUEL_LITER_CYCLE = [35.0, 32.4, 38.2, 30.0, 33.5, 36.1, 31.8, 34.2];

/** total_price_cents = round(unit_price_milli * package_size / 10) (Spec 02 §8.3). */
function calculateTotalPriceCents(unitPriceMilli: number, packageSize: number): number {
  return Math.round((unitPriceMilli * packageSize) / 10);
}

// ---------------------------------------------------------------------------
// Pure builders: months + fixed data -> entry rows (no ids, no I/O).
// ---------------------------------------------------------------------------

function buildGroceryEntries(
  months: YearMonth[],
  sessionIdByMonthIndex: string[],
): CreatePriceEntryInput[] {
  const entries: CreatePriceEntryInput[] = [];

  for (const product of GROCERY_PRODUCTS) {
    months.forEach((ym, monthIndex) => {
      const unitPriceMilli = product.prices[monthIndex];
      const totalPriceCents = calculateTotalPriceCents(unitPriceMilli, product.packageSize);
      const promo = product.promos?.find((candidate) => candidate.monthIndex === monthIndex);
      const isPromo = promo !== undefined;
      const isPhoto = product.photoMonthIndex === monthIndex;
      const sessionId = sessionIdByMonthIndex[monthIndex];

      entries.push({
        productId: product.id,
        storeId: STORE_ESSELUNGA.id,
        sessionId,
        recordedAt: romeDateTime(ym, 5, 10, 30),
        totalPriceCents,
        packageSize: product.packageSize,
        unitPriceMilli,
        isPromo,
        promoKind: promo?.kind,
        source: isPhoto ? 'photo' : 'manual',
        currency: 'EUR',
        ...(isPhoto
          ? { aiConfidence: 0.93, aiModel: 'claude-haiku-4-5', photoUrl: null, aiRawJson: null }
          : {}),
      });

      if (product.secondEntryDay18) {
        entries.push({
          productId: product.id,
          storeId: STORE_ESSELUNGA.id,
          sessionId,
          recordedAt: romeDateTime(ym, 18, 10, 30),
          totalPriceCents,
          packageSize: product.packageSize,
          unitPriceMilli,
          isPromo: false,
          source: 'manual',
          currency: 'EUR',
        });
      }

      // The last two months also see the product at Carrefour (day 12),
      // standalone — no session — so the timeline shows plain rows too.
      const carrefourIndex = monthIndex - (months.length - 2);
      const carrefourPrice = product.carrefourPrices?.[carrefourIndex];
      if (carrefourPrice !== undefined) {
        entries.push({
          productId: product.id,
          storeId: STORE_CARREFOUR.id,
          sessionId: null,
          recordedAt: romeDateTime(ym, 12, 18, 45),
          totalPriceCents: calculateTotalPriceCents(carrefourPrice, product.packageSize),
          packageSize: product.packageSize,
          unitPriceMilli: carrefourPrice,
          isPromo: false,
          source: 'manual',
          currency: 'EUR',
        });
      }
    });
  }

  return entries;
}

function buildFuelEntries(months: YearMonth[]): CreatePriceEntryInput[] {
  const entries: CreatePriceEntryInput[] = [];

  months.forEach((ym, monthIndex) => {
    const unitPriceMilli = FUEL_PRODUCT.prices[monthIndex];
    const litersDay6 = FUEL_LITER_CYCLE[(monthIndex * 2) % FUEL_LITER_CYCLE.length];
    const litersDay20 = FUEL_LITER_CYCLE[(monthIndex * 2 + 1) % FUEL_LITER_CYCLE.length];

    for (const [day, liters] of [
      [6, litersDay6],
      [20, litersDay20],
    ] as const) {
      entries.push({
        productId: FUEL_PRODUCT.id,
        storeId: STORE_ENI.id,
        sessionId: null,
        recordedAt: romeDateTime(ym, day, 8, 15),
        totalPriceCents: calculateTotalPriceCents(unitPriceMilli, liters),
        packageSize: liters,
        unitPriceMilli,
        isPromo: false,
        source: 'fuel',
        currency: 'EUR',
      });
    }
  });

  return entries;
}

// ---------------------------------------------------------------------------
// Writer.
// ---------------------------------------------------------------------------

/** Delete a seed user (and, by cascade, all of their data) if it already exists. */
async function wipeExistingUser(email: string): Promise<void> {
  await db.delete(users).where(eq(users.email, email));
}

async function createSeedUser(seed: {
  email: string;
  password: string;
  name: string;
}): Promise<string> {
  const result = await auth.api.signUpEmail({
    body: { email: seed.email, password: seed.password, name: seed.name },
  });
  return result.user.id;
}

async function seedPrimaryUser(): Promise<void> {
  await wipeExistingUser(SEED_USER.email);
  const userId = await createSeedUser(SEED_USER);

  await db.insert(stores).values([
    { ...STORE_ESSELUNGA, userId },
    { ...STORE_ENI, userId },
    { ...STORE_CARREFOUR, userId },
  ]);

  await db.insert(products).values([
    ...GROCERY_PRODUCTS.map((product) => ({
      id: product.id,
      userId,
      name: product.name,
      brand: product.brand,
      category: product.category,
      unitKind: product.unitKind,
    })),
    {
      id: FUEL_PRODUCT.id,
      userId,
      name: FUEL_PRODUCT.name,
      brand: FUEL_PRODUCT.brand,
      category: FUEL_PRODUCT.category,
      unitKind: FUEL_PRODUCT.unitKind,
    },
  ]);

  const months = buildSeedMonths();
  // Two-digit suffix: seedId pads with zeros, so 'm1' and 'm10' would collide.
  const sessionIdByMonthIndex = months.map((_, index) =>
    seedId(`seed-session-m${String(months.length - 1 - index).padStart(2, '0')}`),
  );
  await db.insert(shoppingSessions).values(
    months.map((ym, monthIndex) => ({
      id: sessionIdByMonthIndex[monthIndex],
      userId,
      storeId: STORE_ESSELUNGA.id,
      status: 'completed' as const,
      startedAt: romeDateTime(ym, 5, 10, 15),
      completedAt: romeDateTime(ym, 5, 11, 0),
    })),
  );

  const entries = [
    ...buildGroceryEntries(months, sessionIdByMonthIndex),
    ...buildFuelEntries(months),
  ];

  await createPriceEntries(db, userId, entries);

  console.log(
    `Seeded primary dev user (${SEED_USER.email}): 3 stores, 13 products, ${months.length} months, ${entries.length} entries.`,
  );
}

async function seedSecondUser(): Promise<void> {
  await wipeExistingUser(SEED_USER_2.email);
  const userId = await createSeedUser(SEED_USER_2);

  const STORE_COOP = {
    id: seedId('seed2-store-coop'),
    name: 'Coop Via Roma',
    chain: 'Coop',
    city: 'Torino',
    kind: 'supermarket' as const,
  };
  const PRODUCT_YOGURT = {
    id: seedId('seed2-prod-yogurt'),
    name: 'Yogurt bianco 4×125g',
    brand: 'Coop',
    category: 'food' as const,
    unitKind: 'count' as const,
    packageSize: 4,
  };

  await db.insert(stores).values({ ...STORE_COOP, userId });
  await db.insert(products).values({
    id: PRODUCT_YOGURT.id,
    userId,
    name: PRODUCT_YOGURT.name,
    brand: PRODUCT_YOGURT.brand,
    category: PRODUCT_YOGURT.category,
    unitKind: PRODUCT_YOGURT.unitKind,
  });

  const currentMonth = getCurrentRomeYearMonth();
  await createPriceEntries(db, userId, [
    {
      productId: PRODUCT_YOGURT.id,
      storeId: STORE_COOP.id,
      sessionId: null,
      recordedAt: romeDateTime(currentMonth, 10, 10, 30),
      totalPriceCents: 179,
      packageSize: PRODUCT_YOGURT.packageSize,
      unitPriceMilli: 448,
      isPromo: false,
      source: 'manual',
      currency: 'EUR',
    },
  ]);

  console.log(`Seeded second dev user (${SEED_USER_2.email}): 1 store, 1 product, 1 entry.`);
}

async function main(): Promise<void> {
  try {
    await seedPrimaryUser();
    await seedSecondUser();
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) {
      console.error('Seed failed: tables are missing. Run `pnpm db:migrate` first.');
      process.exit(1);
    }
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
