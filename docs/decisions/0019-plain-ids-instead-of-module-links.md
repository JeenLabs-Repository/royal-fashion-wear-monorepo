# 0019 Plain Ids Instead of Module Links

Status: accepted

Date: 2026-11-25

## Context

The Medusa guidance prefers module links to connect data across modules, and the `defineLink` helper creates one. A link makes the linked data reachable through Store API field expansion, so a link between vendor data and a product or order would let a customer request vendor fields.

## Decision

Vendor data connects to commerce data only through plain id columns and lookups inside workflows. The vendor module defines no link, the locations table holds a plain `stock_location_id`, and plugins keep their data under a plain `vendor_id` and `vendor_location_id`. A test greps the module and workflow folders for the link helper, and the field guard on the Store API rejects vendor related terms as a second layer.

## Consequences

Code that needs vendor data and commerce data together makes two reads in a workflow and joins them in code. No query can join across them. This costs a little code and removes a whole class of leaks.

Undo cost: costly, because later modules and the compliance plugin build on the plain id shape.

## Alternatives Considered

- Link vendors to products and locations and rely on field filtering. Rejected because one missed filter leaks a vendor.
- Store vendor data in metadata. Rejected because metadata is returned to customers by design.
