# Catalog And Stock

This page explains how a product gets from a vendor's draft to a customer's product page, how images and identifiers keep the vendor anonymous, and how stock works at each vendor location. Read it before you change any catalog or stock code.

## The Catalog Module Holds Five Tables

The catalog module lives in `apps/backend/src/modules/vendor-catalog/`. It stores only the vendor side of a product. It never holds customer-facing data, and nothing from it goes into core product `metadata`.

| Table | What it holds |
|---|---|
| Product submission | One row per product with its review state, the content the vendor sent, the single pending revision, the approved content hash and the review decision |
| Vendor variant ref | The link from a vendor SKU to a core variant, scoped by vendor |
| Product declaration | The Legal Metrology fields the vendor entered for a product |
| Vendor upload | One row per uploaded image, so a vendor can attach only images it uploaded itself |
| Catalog counter | The next platform SKU number |

No module link joins these tables to commerce models. Code reads them by plain ids inside server-side workflows and returns data to customers only through allowlist serializers.

## A Submission Moves Through Six States

A submission is in one state at a time, and it is live or not live. A live product is on sale. The state machine in `apps/backend/src/lib/catalog/state-machine.ts` is the only place that decides which move is allowed.

| State | Meaning | Moves out of it |
|---|---|---|
| Draft | The vendor is still writing | edit, submit |
| Submitted | A staff member must decide | approve, reject, request changes, withdraw |
| Approved | The product is live | live edit, withdraw |
| Changes requested | The vendor must change something | edit, submit, withdraw |
| Rejected | The store declined it | none, the vendor starts a new draft |
| Withdrawn | The vendor took it off sale | edit, submit |

A live product that gets a live edit goes back to Submitted while it stays live. Rejecting a live edit returns it to Approved, so the live version keeps selling.

## A Draft Becomes Live Only After Approval

A draft is a core product with the status `draft`. It is in no sales channel, so the Store API never lists it. When the vendor submits, the core status becomes `proposed`, and the product is still invisible.

Approval is the step that makes it public. A staff member with the `catalog:review` permission sets the customer price for each variant, the GST class, the HSN code and the category, and ticks the six anonymity checks. The approval workflow then assigns the platform identifiers, writes the prices, sets the core status to `published` and links the default sales channel.

Approval is of one content hash. If the vendor or another staff member changes the content after the reviewer opened the page, approval answers 409 and the reviewer reloads.

The customer price is the price the approver sets. The price the vendor enters is the payout the store pays the vendor, and it never leaves the catalog module.

## Live Edits Wait As One Pending Revision

When a vendor edits a live product, the new content is saved as a single pending revision. The live product does not change. The vendor can discard the revision or submit it. After approval the workflow applies the revision to the core product and keeps the handle and the existing SKUs.

A product has at most one pending revision. A second edit replaces the first.

## The Anonymity Pipeline Runs In Order

Each step removes one way a customer could learn who the vendor is.

1. The platform assigns the SKU. It has the form `PL-` and eight digits, taken from the catalog counter. The vendor SKU stays in the catalog module.
2. The platform assigns the handle. It is a slug of the title plus five random base32 characters, so the URL never repeats a vendor's naming.
3. Every image is re-encoded to WebP at a long edge of at most 2000 pixels. The re-encode drops all metadata, including location data and camera data.
4. The image gets a random key of the form `products/<uuid>.webp` that contains no vendor, product or file name part.
5. The structured data on the product page names the store as brand and seller. It reads no vendor text and no free text from product `metadata`.
6. The product page shows only the state a product ships from, as `Ships from {State}`.

The sitemap, `llms.txt` and search read only approved titles, descriptions and platform handles. A canary suite seeds distinctive fake vendor strings and fails when any of them appears on a customer surface.

## Stock Is Tracked Per Location

Stock is the core inventory level for a variant at a vendor stock location. A vendor sets an absolute quantity from 0 to 1,000,000 for its own locations and only for live products. Last write wins.

A vendor cannot set a quantity below the reserved quantity at that location. The request fails with `below_reserved` and the reserved number, because a lower value would let the store oversell.

Customers see availability as the sum over all locations linked to the sales channel. The ship-from state of a product is the state of every active vendor location that has stocked units above the reserved units for one of its variants. One to three states are listed alphabetically, and four or more show `Ships from multiple states`.

## The Hub Location Holds Shipping Together

The Hub is one stock location the store owns. It carries the fulfilment set and the standard delivery option that checkout uses, so shipping options do not depend on any vendor location. It holds no vendor stock. The [reservation and Hub record](../decisions/0020-reservation-fulfilment-and-hub-spikes.md) shows what the platform does with reservations and shipping options and why this layout was chosen.

## Legal Metrology Display Is Set By The Owner

The Legal Metrology fields exist on every product. What customers see depends on a display mode saved in the customer identity card in the Admin.

| Mode | What the product page shows |
|---|---|
| Hidden | Nothing. This is the default, and it also applies when no card exists or the read fails |
| Owner marketer | One line, `Marketed by`, with the owner's text |
| Product declared | The generic name, country of origin, packed by and address exactly as the vendor entered them |

The last mode can reveal the vendor, and the review screen warns about it. The store owner and a lawyer choose the mode. Until they answer, the default stays hidden.

## Suspension Hides And Restores Products

When you suspend a vendor, every live product of that vendor leaves the sales channel, moves to core status `draft` and gets a hidden flag. The storefront stops serving those pages. When you reactivate the vendor, the products return to `published` and the channel without a new review. If activation fails, the products stay hidden.

## Related Pages

- [Review And Approve Products](../guides/review-and-approve-products.md)
- [Manage Vendor Products And Stock](../guides/vendor-products-and-stock.md)
- [Catalog core product behavior record](../decisions/0021-catalog-core-product-behaviour.md)
