/*
 * Renders every PWA icon from docs/assets/logo.svg with sharp (Spec 06 §4.2).
 *
 * Composition rules:
 * - "any" icons: paper background, logo scaled to 80% (10% padding/side) —
 *   transparent icons look broken on light OS install surfaces.
 * - maskable + apple-touch: paper background, logo scaled to 60% (20%
 *   padding/side) so any platform mask (circle, squircle, rounded square)
 *   never clips the mark. iOS applies its own corner mask, so apple-touch
 *   uses the same padded composition.
 * - favicon.ico: transparent background, logo full-frame, 16/32/48 px.
 *
 * Why paper and not the highlighter accent Spec 06 §4.2 first proposed: the
 * mark itself IS the accent (the orange tag of docs/assets/logo.svg), so an
 * accent plate would erase the tag and leave the ink dots floating alone.
 * Cream stock is also the app's own world (DESIGN.md), and it separates the
 * icon from both light and dark OS surfaces.
 *
 * Outputs are COMMITTED to the repo so production builds never need sharp.
 * Re-run with `pnpm icons` whenever logo.svg or BRAND_COLORS change.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const LOGO_PATH = 'docs/assets/logo.svg';
const ICONS_DIR = 'public/icons';

// WARNING: keep in sync with the color table in docs/specs/06-pwa-offline.md
// §3 and with src/app/manifest.ts — all three are the sRGB conversion of the
// `background` token in src/app/globals.css (DESIGN.md owns the value).
const BRAND_COLORS = { background: '#faf5eb' };

const FAVICON_SIZES = [16, 32, 48];

interface IconTarget {
  outputPath: string;
  size: number;
  logoScale: number;
}

const ICON_TARGETS: IconTarget[] = [
  { outputPath: `${ICONS_DIR}/icon-192.png`, size: 192, logoScale: 0.8 },
  { outputPath: `${ICONS_DIR}/icon-512.png`, size: 512, logoScale: 0.8 },
  { outputPath: `${ICONS_DIR}/maskable-192.png`, size: 192, logoScale: 0.6 },
  { outputPath: `${ICONS_DIR}/maskable-512.png`, size: 512, logoScale: 0.6 },
  { outputPath: 'public/apple-touch-icon.png', size: 180, logoScale: 0.6 },
];

/**
 * Render the logo centered on a solid brand background.
 *
 * @param logoSvg - Raw SVG bytes of docs/assets/logo.svg
 * @param size - Output edge in px (square)
 * @param logoScale - Fraction of the edge the logo occupies (0..1)
 * @returns PNG buffer
 */
async function renderIconPng(logoSvg: Buffer, size: number, logoScale: number): Promise<Buffer> {
  const logoEdge = Math.round(size * logoScale);
  const logoPng = await sharp(logoSvg)
    .resize(logoEdge, logoEdge, { fit: 'contain' })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BRAND_COLORS.background,
    },
  })
    .composite([{ input: logoPng, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function generateIcons(): Promise<void> {
  const logoSvg = await readFile(LOGO_PATH);
  await mkdir(ICONS_DIR, { recursive: true });

  for (const target of ICON_TARGETS) {
    const png = await renderIconPng(logoSvg, target.size, target.logoScale);
    await writeFile(target.outputPath, png);
  }

  // favicon.ico: multi-size, transparent, logo full-frame.
  const faviconPngs = await Promise.all(
    FAVICON_SIZES.map((size) =>
      sharp(logoSvg).resize(size, size, { fit: 'contain' }).png().toBuffer(),
    ),
  );
  await writeFile('public/favicon.ico', await pngToIco(faviconPngs));

  console.log(`generate-icons: wrote ${ICON_TARGETS.length} icons + favicon.ico`);
}

generateIcons().catch((error: unknown) => {
  console.error('generate-icons: failed', error);
  process.exit(1);
});
