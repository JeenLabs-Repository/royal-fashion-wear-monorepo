# Settings Cards Live In The Settings Plugin

Status: accepted

Date: 2026-11-26

## Context

Every Integration Module settings card for this store (Razorpay, GST and owner legal identity, SMTP, and vendor onboarding) is built and released in plugin packages. The application must not keep a second copy of those descriptors. Earlier vendor-domain work already shipped a typed reader for vendor onboarding that re-checks agreement files at read time.

## Decision

1. Install `@jeenlabs-repository/medusa-store-settings` and `@jeenlabs-repository/medusa-payment-razorpay` by exact pin from the private registry.
2. Register the four cards by package path under the Gorgo Integration Module `providers` array, with ids `razorpay`, `gst-invoicing`, `smtp` and `vendor-onboarding`.
3. Keep typed readers in the application. The vendor onboarding reader continues to call `agreementFilesExist` and falls back to defaults when the card is absent or the saved agreement version has no files.
4. The application never held a local `src/providers/integration-vendor-onboarding` tree, so nothing was removed here. The settings plugin supplies that identifier.

## Consequences

Saved option values keep applying across the move because the card identifiers and option keys stay the same. Renaming or removing an option is a major plugin release. The agreement-file check stays in the application reader, not in the plugin.

## Undo Cost

Costly: registration paths and provider ids are written into configuration and, through the Integration Module, into stored settings. Rolling back means pinning previous plugin versions and restoring prior registration blocks.
