import { notFound } from 'next/navigation';

/**
 * Catch-all under [locale]: without it an unknown URL would render the
 * framework's default 404 outside the locale layout, so it could neither
 * translate nor theme.
 */
export default function CatchAllPage() {
  notFound();
}
