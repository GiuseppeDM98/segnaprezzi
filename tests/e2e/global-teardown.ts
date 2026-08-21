import { PWA_E2E_USER } from './fixtures/users';
import { deleteUserByEmail } from './helpers/db';

/**
 * Remove the throwaway account the Spec 06 suites created, and with it (by
 * FK cascade) every product, session and entry they confirmed. Repeated
 * local runs therefore never accumulate data that scripts/seed.ts does not
 * know about — the same discipline auth.spec.ts applies to its signup user.
 */
export default async function globalTeardown(): Promise<void> {
  await deleteUserByEmail(PWA_E2E_USER.email);
}
