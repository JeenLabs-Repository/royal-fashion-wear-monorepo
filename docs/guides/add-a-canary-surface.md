# Add a Canary Surface

This guide explains how to add a customer-facing output to the anonymity canary suite, so a leak of vendor data through it fails the build.

## When You Need a Surface

Add a surface whenever a change creates or alters something a customer, a crawler or a courier can see: a page, an API response, an image, an email, a PDF, a label or a tracking page. Vendor strings must never appear in any of them.

## Register the Surface

1. Create `apps/backend/integration-tests/canary/surfaces/<area>.ts`.
2. Call `registerSurface` with these fields.
   - `id`: a unique, descriptive name such as `order-pages-html`.
   - `kind`: one of `store-api`, `storefront-html`, `storefront-rsc`, `storefront-json-ld`, `sitemap`, `llms-txt`, `image`, `email`, `pdf`, `tracking` or `plugin-placeholder`.
   - `owner`: the area that maintains it.
   - `description`: one sentence on what the surface covers.
   - `minRequests`: how many responses the surface must return at least. It must be 1 or more.
   - `collect`: an async function that returns `{ url, status, contentType, body }` for every response to scan.
3. Add one import line for the file to `surfaces/index.ts`.
4. Run the crawl (see below). Fix any finding at the source, never in the test.

## How Collect Works

`collect` receives the backend and storefront URLs, the locale and the seed manifest (publishable key, canary vendor ids and credentials). It returns plain responses. The runner scans every body for every canary string and for its common encodings: lower case, percent encoding, JSON unicode escapes, HTML entities and the usual phone formats. A status of 500 or more counts as a failure even when the body is clean.

## Notes by Kind

- Images: return the bytes as a `Buffer`. The runner reads them as latin1 so embedded text such as EXIF fields stays searchable.
- Emails: return the rendered HTML and text parts of each message, with the subject and headers as part of the body.
- PDFs: return the extracted text and the raw bytes decoded as latin1 in one body, so both visible text and metadata are scanned.
- Tracking and labels: scan the public tracking page and every label a courier receives.

## Empty Surfaces Fail

The suite fails when a registered surface was never exercised or returned fewer responses than `minRequests`. This is on purpose: a surface that silently collects nothing proves nothing. The summary at the end of the crawl lists every surface with its request count and the kinds that still have no surface.

## Swap the Plugin Placeholder

The `plugin-routes-placeholder` surface checks that a plugin route path answers 401 without credentials and 404 for an enrolled vendor. When a compliance plugin registers real vendor routes, replace the placeholder with surfaces that call those routes and keep the fake tax identifiers in the scanned tokens.

## Run the Crawl

Locally:

```sh
sh scripts/run-canary.sh
```

The script creates a throwaway database, builds and seeds, starts the backend and the storefront, runs `pnpm -C apps/backend run test:canary` and stops both servers on exit. Pass `--skip-build` to reuse the backend build. In CI the same script runs in the `canary` job.

Findings print the surface address, the matched string, the form it took and a 40-character excerpt, never the whole page.

