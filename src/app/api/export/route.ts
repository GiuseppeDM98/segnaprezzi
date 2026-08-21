import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { UnauthorizedError } from '@/lib/errors';
import { exportUserData } from '@/lib/services/export';

export async function GET() {
  try {
    const user = await requireUser();
    const payload = await exportUserData(db, user.id);

    const date = new Date().toISOString().slice(0, 10);
    return NextResponse.json(payload, {
      headers: {
        'Content-Disposition': `attachment; filename="segnaprezzi-export-${date}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw error;
  }
}
