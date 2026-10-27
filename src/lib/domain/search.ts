/**
 * Rules shared by every picker that searches as the user types. Pure — no
 * imports.
 */

/**
 * Shortest trimmed query a picker acts on: below it the catalog search is not
 * run and the store picker offers no "create" row, because one letter matches
 * nearly everything and names nothing.
 */
export const MIN_QUERY_LENGTH = 2;
