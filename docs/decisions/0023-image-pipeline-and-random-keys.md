# 0023 Image Pipeline And Random Keys

Status: accepted

Date: 2026-11-25

## Context

Photos carry location data, camera data and file names that can identify a vendor. Customers see the image URL and can download the bytes.

## Decision

Every upload runs through one `sharp` pipeline before storage. It detects the type from magic bytes, rejects animated images, applies the EXIF orientation, resizes to a long edge of at most 2000 pixels and re-encodes to WebP at quality 82 with all metadata dropped. Concurrency is 1 and the cache is off, so image work stays inside the memory budget.

The stored key is `products/<uuid>.webp`. It never contains the vendor, the product or the original file name. The file provider may add a timestamp prefix or a suffix, and the tests accept only those optional parts.

## Consequences

Served bytes contain no metadata, and the canary suite downloads them to prove it. The re-encode costs CPU on upload, and the original file is not kept. A vendor who wants the original back must upload it again.

Undo cost: costly, because stored keys are public URLs that pages and caches already refer to.
