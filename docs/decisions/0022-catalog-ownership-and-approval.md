# 0022 Catalog Ownership And Approval

Status: accepted

Date: 2026-11-25

## Context

Vendors write product content, but customers must buy from one store brand and never learn who the vendor is. The core product model has no place for per-vendor content, review state or a pending revision.

## Decision

A catalog module with plain id columns holds the vendor side. It has no module link to commerce models. The core product reuses its own status. A draft is `draft`, a submitted product is `proposed`, and approval publishes it and links the sales channel.

Approval is bound to a content hash, so a change after the reviewer opened the page makes approval fail with 409. The approver sets the customer price, GST class, HSN code and category, and the vendor price is only the payout. A vendor edit to a live product is stored as one pending revision, and the live version keeps selling until the revision is approved.

## Consequences

Customer-facing code can never reach vendor data by following a relation. Every review decision is auditable with its checklist and hash. The cost is that every catalog read for staff and vendors goes through serializers and workflows instead of the core admin routes.

Undo cost: costly, because published products, platform SKUs and handles refer to this layout and customers hold links to those handles.
