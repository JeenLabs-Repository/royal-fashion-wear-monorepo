# Anonymity Test Suite

This page explains how the automated tests prove that vendor identity never reaches a customer and that one vendor never reaches another.

## The Four Layers

The design protects vendor data in four layers, and each layer has its own tests.

1. No links. Vendor data connects to commerce data only through plain ID columns, never through module links, so a Store API field expansion cannot reach it.
2. Serializers. Every vendor, store and document response passes through an allowlist serializer that drops unknown keys.
3. Store guard. A guard on every `/store` request refuses forbidden `fields`, `expand` and `include` terms.
4. Metadata invariant. Vendor data is never written to core `metadata`, stock location names or addresses. A test scans those records after vendors and locations exist.

## The Two End-to-End Suites

The canary suite seeds vendors whose every field holds a distinctive string and crawls the customer-facing surfaces over plain HTTP. It fails if any string appears. A tripwire test proves the scanner can fail: a local server leaks strings in HTML, a streamed payload, JSON-LD and a JSON metadata field, and the pipeline must report each one.

The cross-vendor matrix generates a test for every vendor route and asserts isolation, strict inputs, suspension, two-factor and activation rules. A route without a fixture fails the build.

## What Each Suite Proves

- The canary suite proves that the surfaces it lists do not leak the seeded strings. It does not prove anything about a surface nobody registered, which is why the registry fails on empty surfaces and reports the kinds that are still missing.
- The metadata invariant test proves that core records carry no vendor strings after the seed ran. It does not inspect data written later by code paths the seed does not call.
- The matrix proves isolation for the routes that exist. It does not prove the correctness of business rules inside a route.

## Registered Surfaces

- `store-api-get-routes`: every GET route of the installed Store API and the project, requested with a publishable key.
- `store-api-starter-fields`: the storefront's own `fields` strings, replayed against the route each was written for.
- `storefront-pages-html`: every static page and every product, category and collection page.
- `storefront-pages-rsc`: the same pages requested with the streaming header.
- `storefront-pages-json-ld`: every structured data block on those pages.
- `storefront-sitemap` and `storefront-llms-txt`.
- `plugin-routes-placeholder`: a plugin route path that no route serves.

## Surfaces Still to Come

Later areas add their own surfaces: product pages and images, order pages, emails, PDFs and tracking. The registry reports these kinds as missing until they exist, and the launch checks turn that report into a failing check.

See [Add a Canary Surface](../guides/add-a-canary-surface.md) for the steps.
