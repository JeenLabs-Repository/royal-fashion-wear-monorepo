# Settings Card Reader

Settings that a store owner changes without a deploy live on cards in the Integration Module. The app reads each card through a small typed reader. This page explains the pattern, so you can add a reader for a new card in a few lines.

## How It Works

A card is a set of named options with defaults, stored by the Integration Module and edited under Settings, Integrations in the dashboard. The app never reads a card directly. It calls a reader from `src/lib/settings`, and the reader returns plain typed values.

The reader factory is `createCardReader` in `src/lib/settings/card-reader.ts`. The only file that knows how to call the Integration Module is `src/lib/settings/resolve-options.ts`. If the module changes how it answers, you change that file and nothing else.

## Four Steps for a New Card

1. Add the card in the settings plugin repository, one folder per card, and release a new version of the plugin.
2. Add a reader in the app under `src/lib/settings`. Define your own option type and your own defaults, then call `createCardReader` with the card identifier, the defaults and a `parse` function that checks each stored value.
3. Write a unit test that covers a valid card, each unavailable state and each out-of-range value.
4. Bump the plugin pin in the app to the new version.

## The Call-Time Rule

Read the card when you need the value, on every call. Never read it in a constructor, at import time or into a module-level variable. A value read early is stale until the next restart.

## Cache Behavior

The Integration Module keeps resolved options for about 60 seconds per process and clears that cache when a card is saved in the same process. The reader adds no cache of its own. Callers that must see a write they just made should clear the options cache (or treat a prior null or old read as possibly sticky for up to a minute). When a store runs more than one backend process, a change can take up to a minute to reach every process, so "the next invitation uses the new value" means within a minute.

## Defaults When No Card Exists

A reader returns its code defaults when the card is missing, unsaved or disabled. This keeps the app working before a card is installed and after someone switches it off. A reader also checks each stored value again and falls back to the default for that one field, with a `[settings]` warning in the log.

## Minimal Types

A reader defines its own minimal option type and imports nothing from a plugin. The app then compiles and runs before any plugin is installed, and a plugin release never breaks the app build.

## Encryption Key

Cards encrypt secret options with the key in `INTEGRATION_ENCRYPTION_KEY`. Every backend process must use the same key, and the key must be backed up with the database backups. Losing it makes stored secrets unreadable.

## Planned Card Identifiers

These identifiers are reserved for the cards the store will add:

- `integration-vendor-onboarding`
- `integration-razorpay`
- `integration-gst-invoicing`
- `integration-smtp`
- `integration-routing-preferences`
- `integration-customer-identity`
- `integration-documents`

## Card Contract for Vendor Onboarding

Card contract. The later vendor onboarding card must declare the following, and the app reader in `src/lib/settings/vendor-onboarding.ts` checks both values again:

- Identifier `integration-vendor-onboarding`, category `other`, display name `Vendor onboarding`.
- Option `invite_expiry_hours`, a number with default 72, minimum 1, maximum 336, required. Description: "Hours an invitation link stays valid. Applies to the next invitation."
- Option `current_agreement_version`, a string with default `v1-draft` and `minLength: 1`, required. Description: the version label of the vendor agreement and the packing guideline. Both documents for that label must exist in the app.
- No secret options.
- Editable by the superadmin role only.

Until the card exists, the reader returns 72 hours and `v1-draft`.
