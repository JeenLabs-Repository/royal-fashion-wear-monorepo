# 0024 Stock Reserved Quantity And CSV Import

Status: accepted

Date: 2026-11-25

## Context

Vendors set stock for their own locations, and customer orders reserve units at a location. A vendor value below the reserved number would let the store oversell. Vendors also need to update many rows at once without risking the server's memory.

## Decision

A vendor sets an absolute quantity per variant and location through the core inventory workflows. The request fails with `below_reserved` and the reserved number when the value is lower than the reserved quantity. Each change writes an audit entry with the old and new quantity.

The CSV import reads a file of at most 1 MiB and 5,000 rows in two streaming passes. The first pass checks the header, the encoding and the row count, so a whole-file problem changes nothing. The second pass applies rows in batches of 100 through the same workflow. A row problem never stops the other rows, and the answer lists at most 200 errors with the true totals. The file buffer is bounded at 1 MiB, so memory use stays small and the limit is simple to explain.

## Consequences

Vendors cannot corrupt reservations, and uploading the same file twice is safe. Last write wins, so two vendor users editing the same cell overwrite each other. Quantities are absolute, so a vendor cannot add a delta in one step.

Undo cost: reversible, because the rule and the import are code and the stored levels follow the core inventory model.
