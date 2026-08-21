export { SEED_USER, SEED_USER_2 } from '../../../scripts/seed-users';

/**
 * A throwaway account owned by the Spec 06 offline/PWA suites.
 *
 * Why not a seed user: those two run against a production server on a
 * different port, in parallel with the rest of the suite, and the offline
 * scenarios confirm real entries — sharing an account with the capture suite
 * (which wipes every photo entry before each of its tests) would make both
 * fail for reasons that have nothing to do with the code. It is created in
 * global-setup.ts and deleted in global-teardown.ts.
 */
export const PWA_E2E_USER = {
  email: 'e2e-offline@segnaprezzi.local',
  password: 'e2e-offline-password',
  name: 'E2E Offline',
};
