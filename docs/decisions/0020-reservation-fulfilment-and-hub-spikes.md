# 0020 Reservation, Fulfilment And Hub Shipping Behaviour On Medusa 2.22.7

Status: accepted

Date: 2026-11-25

## Context

Routing an order to a vendor location and fulfilling it from there rests on three assumptions about Medusa that were read from source and never run. If one is wrong, the routing and fulfilment work has to be redesigned, so each was tested on a running application before anything depends on it. Each experiment ran against a test database, in two layouts: `hub-only` (the production layout, one fulfilment set on the Hub stock location, vendor locations without one) and `per-location` (every vendor location has its own fulfilment set, used as the control).

## Method

Medusa 2.22.7 exactly. Three specs under `apps/backend/integration-tests/http/` (`spike-s1-reservation`, `spike-s2-explicit-location-fulfilment`, `spike-s3-hub-shipping-option`) build a fixture of two vendor stock locations (one in Maharashtra, one in Karnataka) and a Hub, complete real carts through the Store API and then move, split and fulfil reservations through the core workflows. Every observation is one JSON line in `apps/backend/integration-tests/.spike-results/` (not committed). Re-run with `pnpm -C apps/backend run test:integration:http -- spike-s`. A step that throws is recorded as a result, so an unexpected answer never fails the specs.

## Results

### Reservation placement

| Creation order | Customer province | Reservation location (hub-only) | Reservation location (per-location) |
|---|---|---|---|
| AB | Karnataka x3, Maharashtra x1 | A, A, A, A | A, A, A, A |
| BA | Karnataka x3, Maharashtra x1 | B, B, B, B | B, B, B, B |

Reservation follows the customer's state: false in both layouts. It lands at the first channel-linked vendor location in creation order (H1 confirmed).

### Moving a reservation

| Step | Result (hub-only) | Result (per-location) |
|---|---|---|
| Move to the other vendor location | ok true; reservation row moves to target; source `reserved` stays 1 and target `reserved` becomes 1 (levels do not transfer) | same |
| Move to a location with no stock | ok false; error `Item … is not stocked at location …`; available at target not negative | same |

`S1_movable` is false in both layouts because the inventory levels do not shift with the reservation row.

### Splitting a reservation

| Variant | Result (hub-only) | Result (per-location) |
|---|---|---|
| Reduce, then create a second reservation | ok true; totals 4; reserved 2 at A and 2 at B | same |
| Delete, then create two | ok true; totals 4; reserved 2 at A and 2 at B | same |

`S1_recreatable` true; `S1_split_ok` true.

### Order larger than one location

| Quantity | Completes (hub-only) | Reservation | Storefront available quantity |
|---|---|---|---|
| 5 (3 and 3 in stock) | false; not_allowed, not enough stock at the chosen location | none | 6 |
| 7 (3 and 3 in stock) | false; insufficient_inventory | none | 6 |

`S1_oversize_completes` false. The storefront shows 6 while checkout rejects 5 and 7.

### Explicit-location fulfilment

| Step | Result (hub-only) | Result (per-location) |
|---|---|---|
| Fulfil at the other location than the reservation | ok true; stocked falls at the fulfilment location; reservation cleared | same |
| Move then fulfil at the moved location | fulfil ok; stocked at target down by 2; reserved at target 0; source still shows reserved after the move | same |
| Fulfil at a location with no stock | ok false; inventory level not found | same |
| Shipment label | tracking_number `AWB-TEST-0001`; tracking_url and label_url empty strings | same |

`S2_explicit_ok` true; `S2_mismatch_tolerated` true; `S2_labels_keep_only_awb` true. Mismatched fulfilment did not leave reserved quantity behind (reserved at source cleared). Move-then-fulfil still left ghost reserved at the source because the move path is broken (see above).

### Hub shipping option

| Step | hub-only | per-location (control) |
|---|---|---|
| Options with stock only at A | Standard Delivery x1 | Standard Delivery x2 |
| Options with stock only at B | Standard Delivery x1 | Standard Delivery x2 |
| Fulfil at the stocked vendor location, then ship | fulfil_ok true; ship_ok true | same |
| Hub not in the sales channel | option_count 0 | Standard Delivery still offered from vendor locations |

`S3_options_ok` true; `S3_fulfil_ok` true; `S3_control_ok` true. No code change to the vendor location workflow.

## Outcome table

| # | Case | Observed | Consequence |
|---|---|---|---|
| 1 | S1 movable true and S2 explicit ok true | false (movable false; explicit ok true) | Not the path. Do not rely on `updateReservationsWorkflow` location changes alone. |
| 2 | S1 movable false but S1 recreatable true | true | Routing holds with delete and recreate instead of move; compensation must restore reservations the same way. |
| 3 | S1 movable false and S1 recreatable false | false | Not triggered. |
| 4 | S2 explicit ok false | false (explicit ok true) | Not triggered; fulfilment may pass the assigned `location_id`. |
| 5 | S3 options ok and S3 fulfil ok both true | true | One Hub fulfilment set stays; vendor locations need no fulfilment set of their own. |
| 6 | Either S3 flag false | false | Not triggered; no per-location fulfilment set fallback applied. |

Informational:

- Reservation does not follow the customer's state; same-state hint stays a staff UX concern, not a reservation concern.
- Quantity larger than any single location does not complete; storefront available can exceed what checkout accepts. Routing must split such lines if the product page keeps summing locations, or product availability copy needs a note when planning routing.
- Mismatched explicit fulfilment cleared the reservation in the observed run; move still leaves ghost reserved at the source, so the drift job and recreate-first rule are mandatory.

## Decision

Use delete-and-recreate (not location update alone) when moving a reservation to the assigned vendor location. Pass an explicit `location_id` on every fulfilment. Keep one Hub fulfilment set and one Standard Delivery option. Treat oversize multi-location checkout failure as a known Medusa behaviour when designing availability and split assignment.

## Consequences

Routing can proceed on the recreate path without forking cart completion. The invariant job that watches reservation drift stays required because a location update leaves ghost reserved quantity. Oversize lines need an explicit product or routing answer later. Undo cost: costly, because later routing and fulfilment code will hard-code recreate and Hub layout.

## Alternatives Considered

- Trusting the source reading that `updateReservationsWorkflow` moves reserved quantity cleanly. Rejected: measured levels keep reserved at the source after a location change.
- Forking cart completion so nothing is reserved until assignment. Not needed while recreate works.
- Adding per-location fulfilment sets now. Not needed while Hub options and Hub-option fulfilment both succeed.

## Draft Differences From The Plan File

- Service zone and fulfilment set names are location-scoped (`{name} India {stockLocationId}` / `{name} shipping {stockLocationId}`) because Medusa 2.22.7 enforces unique service zone names and a set may link to only one stock location; the starter seed already owns bare `India`.
- Store currency update in the fixture preserves existing `is_default` when adding INR.
- `inApp: true` was dropped from the new specs (types for `medusaIntegrationTestRunner` reject it; other older specs still carry it).
- No vendor-location fulfilment fallback code was added (S3 flags both true).

ROUTING RESERVATION DESIGN: STANDS
