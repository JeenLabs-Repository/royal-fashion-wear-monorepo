# 0009 Manual Order Routing

Status: proposed

Date: 2026-11-24

## Context

Customers place one order that may hold products from several vendors. Splitting carts per vendor would reveal that several vendors exist.

## Decision

Keep one customer order and no split carts. The owner routes each line to a vendor location by hand and prefers the customer's state. The stock reservation must follow the assignment and every fulfilment passes an explicit location. Do not assume Medusa's reservation placement or its move and split behavior. Prove it with a spike on 2.22.7 before routing is built. This record stays proposed until the spike is done.

## Consequences

The owner does the routing work. Routing code waits for the spike result.

Undo cost: costly, because order data, reservations and fulfilments depend on it.

## Alternatives Considered

- Automatic nearest-vendor routing. Rejected for launch because the owner wants control.
- Split carts per vendor. Rejected because it reveals the vendors.
