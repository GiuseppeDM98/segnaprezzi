/*
 * Give the unit suite an IndexedDB.
 *
 * Dexie is a browser API wrapper, and the offline queue (Spec 03) plus the
 * sync engine (Spec 06) are the code most worth testing in this repo — so
 * the runner gets a real in-memory implementation instead of a hand-written
 * mock, which would only ever assert that our mock matches our expectations.
 * Each test file gets a fresh module registry, so databases do not leak
 * between files.
 */
import 'fake-indexeddb/auto';
