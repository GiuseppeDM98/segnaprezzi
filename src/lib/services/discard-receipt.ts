/**
 * Abandon an import in progress (Spec 07 §8.3, last paragraph).
 *
 * The row survives the discard on purpose: `(user_id, content_hash)` is
 * unique, so re-uploading the same file resumes this record instead of
 * paying the model to read the document a second time.
 */
import type { Db } from '@/lib/db/client';
import { getReceiptById, updateReceipt } from '@/lib/db/repositories/receipts';
import { ReceiptNotFoundError } from '@/lib/errors';

export interface DiscardReceiptResult {
  receiptId: string;
}

/**
 * Mark one extracted receipt as discarded. Idempotent.
 *
 * @throws ReceiptNotFoundError when the receipt is not the user's, or was
 *   already confirmed — a confirmed import has entries, and unwinding those
 *   is a delete-entries job, not a discard
 */
export async function discardReceipt(
  db: Db,
  userId: string,
  receiptId: string,
): Promise<DiscardReceiptResult> {
  const receipt = await getReceiptById(db, userId, receiptId);
  if (!receipt || receipt.status === 'confirmed') {
    throw new ReceiptNotFoundError(receiptId);
  }
  if (receipt.status === 'discarded') {
    return { receiptId: receipt.id };
  }

  await updateReceipt(db, userId, receiptId, { status: 'discarded' });
  return { receiptId: receipt.id };
}
