/** A variant at a location is low when stocked minus reserved is below this. */
export const LOW_STOCK_THRESHOLD = 5;

/** Largest absolute stock quantity a vendor can set. */
export const MAX_STOCK_QUANTITY = 1_000_000;

/** Entries in one PUT request. */
export const MAX_ENTRIES_PER_REQUEST = 100;

/** Rows applied by one run of the stock workflow during an import. */
export const IMPORT_BATCH_SIZE = 100;

/** Data rows in one import file, header excluded. */
export const IMPORT_MAX_ROWS = 5_000;

/** Size of one import file. */
export const IMPORT_MAX_BYTES = 1_048_576;

/** Row errors listed in an import answer; the totals stay true. */
export const IMPORT_MAX_LISTED_ERRORS = 200;

/** Bytes decoded at a time, so the parser never receives the whole file as one string. */
export const DECODE_SLICE_BYTES = 64 * 1024;

/** Variants per page of the stock list. */
export const STOCK_PAGE_SIZE = 50;

export const CSV_HEADER = ["vendor_sku", "location_code", "stocked_quantity"] as const;
