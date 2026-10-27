import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { exportUserData } from '@/lib/services/export';
import { toErrorResponse } from '../route-errors';

/**
 * GET /api/export — the user's data as a downloadable JSON file, in the shape
 * importBackup (settings/actions.ts) accepts back. Failures answer with the
 * same `{ error: { code, message } }` body as every other handler:
 * unauthenticated callers get a 401, anything unexpected is logged with the
 * user id and becomes a 500.
 */
export async function GET(): Promise<Response> {
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const payload = await exportUserData(db, userId);

    const date = new Date().toISOString().slice(0, 10);
    return NextResponse.json(payload, {
      headers: {
        'Content-Disposition': `attachment; filename="segnaprezzi-export-${date}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return toErrorResponse(error, { route: 'GET /api/export', userId });
  }
}
