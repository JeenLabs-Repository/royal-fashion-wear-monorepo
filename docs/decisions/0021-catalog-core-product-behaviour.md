# 0021 Catalog Core Product Behaviour On Medusa 2.22.7

Status: accepted

Date: 2026-11-25

## Context

Vendor drafts are real core products reached only through core workflows. The content helpers and create workflow need exact behaviour for variants without prices, option edits, image order, channel link events and inventory items. The documented 2.22.7 shapes were not enough, so each step was run on a test database and recorded.

## Method

Medusa 2.22.7 exactly. Spec `apps/backend/integration-tests/http/spike-catalog-core-product.spec.ts` records one JSON line per step under `integration-tests/.spike-results/c.jsonl` (not committed). Re-run with `pnpm -C apps/backend run test:integration:http -- spike-catalog-core-product`. A step that throws is recorded as a result, so only broken setup fails the suite.

## Create Without Prices Or Sales Channel

| Observation | Result |
|---|---|
| Create with no `prices` field | ok; no empty prices array needed |
| Variant SKU | null on every variant |
| Price rows | 0 |
| Inventory item per variant | yes (2 for 2 variants) |
| Inventory levels | 0 |
| Sales channels | 0 |
| Store API list | not listed |
| Store API by id | 404 |

## Structure Updates

| Step | Result |
|---|---|
| Extend option values via `updateProductsWorkflow` with `{ id, title, values }` | fails; that shape is a link-by-id payload and ignores `values` |
| Extend via `updateProductOptionsWorkflow` then create a variant | fails; new values are not linked to the product |
| Extend via `createAndLinkProductOptionsToProductWorkflow` (`update[].add: [{ value }]`) then `createProductVariantsWorkflow` | ok; option values include L; variant count 3; new variant gets an inventory item; existing variants stay |
| `updateProductsWorkflow` with a variants array that omits some | omitted variants are deleted (3 became 1); they do not stay untouched |
| Rename an option value via `updateProductOptionValuesWorkflow` | ok; variant option mapping follows the renamed value without a separate remapping call |

## Variant Deletion

| Observation | Result |
|---|---|
| `deleteProductVariantsWorkflow` | removes the variant |
| Inventory item remains | false |
| Inventory item still linked to variants | empty |

## Images And Order

| Step | Order returned by rank |
|---|---|
| Two images set | first URL then second URL, matching the array |
| Reordered | first becomes the previous second; array order is the rank order |

## Publish, Hide And Events

| Step | Events emitted | Store API |
|---|---|---|
| Publish with the sales channel on `updateProductsWorkflow` | `product.product.updated`, `product.updated`, `LinkProductSalesChannel.attached` | listed and by-id 200 |
| Unlink with `linkProductsToSalesChannelWorkflow` (`remove`) | `LinkProductSalesChannel.detached`, `product.updated` | by-id 404; list can still include the id in this suite |
| Relink with `linkProductsToSalesChannelWorkflow` (`add`) | `LinkProductSalesChannel.attached`, `product.updated` | listed and by-id 200 |

Storefront revalidation fires without help: yes (`product.updated` on unlink and relink). The export name on 2.22.7 is `linkProductsToSalesChannelWorkflow`, not `batchLinkProductsToSalesChannelWorkflow`.

## Type, Origin Country And HS Code

| Field | Persisted and returned |
|---|---|
| Product type | yes (`type_id` matches) |
| Origin country | yes (`IN`) |
| Variant HS code | yes (`6109`) |

## Rules The Catalog Code Follows

1. Create drafts with `createProductsWorkflow`, status `draft`, no sales channel, no prices field, no SKU; inventory items appear with no levels; the Store API hides the draft.
2. Extend option values with `createAndLinkProductOptionsToProductWorkflow`, then add variants with `createProductVariantsWorkflow`. Do not put `{ id, title, values }` on `updateProductsWorkflow.options`.
3. A variants array on `updateProductsWorkflow` replaces the full list and deletes omitted variants; catalog code may delete through `deleteProductVariantsWorkflow` or omit from the update list, and must always send every kept variant.
4. Deleting a variant removes its inventory item; no leftover inventory cleanup is required for an unused draft variant.
5. Image order follows the `images` array order on `updateProductsWorkflow`.
6. Unlink and relink use `linkProductsToSalesChannelWorkflow`; `product.updated` is enough for storefront revalidation.
7. `type_id`, `origin_country` and variant `hs_code` persist through `updateProductsWorkflow`.

## Adaptations To The Helpers

- `applyContentToProduct` syncs new option values through `createAndLinkProductOptionsToProductWorkflow` before writing variants, and creates new variants through `createProductVariantsWorkflow` when option values were just linked. It never passes a sales channel, status, handle, SKU or prices.
- Channel unlink uses `linkProductsToSalesChannelWorkflow` wherever approval or withdraw needs it later.
- Load helpers request `options.values.id` when a rename path needs the value id.
