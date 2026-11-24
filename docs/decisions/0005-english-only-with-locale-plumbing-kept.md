# 0005 English Only With Locale Plumbing Kept

Status: accepted

Date: 2026-11-24

## Context

The starter ships 36 languages, a demo catalog and right-to-left support. The store launches in English.

## Decision

Ship English only. Delete every other storefront, email and seed catalog, Hindi included. Keep an untouched copy of the starter outside the repository for recovery. Keep the next-intl setup, the cookie-based locale, `localePrefix` set to never, the locale list in config and the language switcher, so adding Hindi is a catalog plus config change. Remove right-to-left support.

## Consequences

Adding a language later means writing a catalog and extending the config. Restoring right-to-left support is a small change if a right-to-left language is ever added.

Undo cost: reversible, because catalogs can be recovered or rewritten.

## Alternatives Considered

- Keep all 36 catalogs. Rejected because unused catalogs rot and slow every change.
- Remove the locale plumbing. Rejected because Hindi is a likely later release.
