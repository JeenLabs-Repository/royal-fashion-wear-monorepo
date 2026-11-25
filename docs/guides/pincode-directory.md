# Refresh the PIN Directory

This guide explains where the bundled PIN directory comes from, how you refresh it and what the lookup route returns.

## Where the Data Comes From

The file `apps/backend/src/lib/geo-india/pincodes.json` is generated from the All India Pincode Directory on data.gov.in. The directory is published under the Government Open Data Licence India (GODL), which allows commercial use when you keep the attribution. The file keeps that attribution in its `source` field and records the generation date in `generated_at`.

When the data.gov.in portal asks for an account or returns a captcha, you may refresh from a 1:1 republish of the same Department of Posts directory (for example a public CSV mirror), as long as the generated file still attributes GODL and data.gov.in. Prefer the portal download when you can.

The downloaded CSV is never committed. The folder `apps/backend/data-source/` is ignored by git.

## Refresh Step by Step

You refresh the file about once a year, or when a new PIN is missing.

1. Download the All India Pincode Directory CSV from data.gov.in and save it as `apps/backend/data-source/pincode-directory.csv`. If the portal asks for an account, ask the owner for the file.
2. From the repository root run `pnpm -C apps/backend run build:pincodes -- data-source/pincode-directory.csv`.
3. Read the printed counts: rows read, rows skipped, conflicts and PINs written. The PIN count must stay between 15,000 and 25,000.
4. Run `pnpm -C apps/backend run test:unit -- --testPathPattern=pincodes` and the HTTP spec `pnpm -C apps/backend run test:integration:http -- --testPathPattern=india-pincode`.
5. Commit the JSON file as its own change.

## When the Script Reports an Unmapped State

The script stops with a message that names the state spelling it could not map. Extend the alias table in `apps/backend/src/lib/geo-india/pincode-build.ts` with that spelling and the ISO code of the right state, add one test row for it, and run the script again. Never skip the row, because a skipped row would silently drop PINs. An unmapped name is always a build failure.

## What the Route Returns

`GET /store/india/pincodes/:pin` needs the publishable key like every store route. It answers with the PIN, the state code, the district, the city and up to five locality names. It sets a one-day cache header.

- A PIN that is not six digits, or that starts with 0, returns 400.
- A PIN that is not in the directory returns 404.

The city is the district name, because the directory has no city column. The storefront lets the customer edit the city.

## Why Unknown PINs Are Still Accepted at Checkout

A new PIN can be missing from an older copy of the directory. Blocking those customers would lose sales, so checkout accepts an unknown PIN with a manual state and city and marks the address as unverified. A later refresh then covers the new PIN.

## How Addresses Are Validated

The store checks every address the storefront can save, on the server, so a client that skips the form cannot store a bad PIN and state pair.

The routes covered are updating a cart (shipping and billing address), creating a customer address and updating a customer address. Other store routes are not touched.

The checks return these codes with HTTP status 400:

| Code | Meaning |
| --- | --- |
| `invalid_pin_format` | The PIN is not six digits, or it starts with 0 |
| `invalid_province` | The state is empty or is not one of the 36 states and union territories in the `in-xx` form |
| `pin_state_mismatch` | The PIN is in the directory and belongs to another state |
| `invalid_phone` | The phone is not a ten-digit mobile number starting with 6, 7, 8 or 9 |

A phone is cleaned before the check: spaces, hyphens and brackets are removed, and a `+91` prefix, a `91` prefix on twelve digits or a leading `0` on eleven digits is dropped. The saved phone is always the ten-digit form.

A PIN that is not in the directory is accepted with the state and city the customer typed. The saved address then carries `metadata.pin_unverified` set to true, so staff can see in the order queue later that the PIN was never matched. A PIN that is in the directory carries no such flag, and a flag left over from an earlier save is removed.

An address in another country skips all of these checks.
