# Plugins Live In Their Own Repositories

This page explains why each store plugin has its own repository and which repositories exist. For the steps, read [Try A Plugin Change Locally Before You Release It](../guides/plugin-local-development.md) and [Release A Plugin And Bump The App Pin](../guides/plugin-release-and-bump.md).

## Why Each Plugin Has Its Own Repository

A plugin can be built, tested and released without the rest of the store. The app consumes each plugin as a released package, so a plugin change reaches the store only after you release it and pin the new version. That keeps the app stable while a plugin is under work, and it keeps the plugin free of store-specific code.

## The Three Repositories

- `medusa-payment-razorpay` holds the Razorpay payment provider, its settings card and its refund and webhook ledger.
- `medusa-store-settings` holds every Integration Module settings card, one folder per card plus a registry that lists them.
- `medusa-vendor-compliance` is planned for a later release and holds the vendor compliance plugin.

The names, the package scope, the registry address and the pinned versions live in one file, `config/plugin-registry.json`. A guard checks the rest of the repository against that file.

## Rules Every Plugin Repository Follows

You apply the same working rules in a plugin repository as in the app.

- It has the same three branches, commit rules, signed commits, CI, secret scanning, rule files and documentation layout. The scaffolder script copies the app's own files, so the rules do not drift.
- It imports nothing from the app.
- It exposes one documented public surface through the exports map in its `package.json`.
- Typed readers for settings stay in the app. They define their own option types, so the app compiles and runs before any plugin is installed.

## How The App Consumes A Plugin

The app installs each plugin from the private registry at an exact version, never a range. You register the plugin's providers in `medusa-config.ts` by package path, never by file path. The guard `check-plugin-refs` fails the build on a path, a link, a range or a local trial file.

## A Settings Card Is A Two-Repository Change

A new settings card lands in `medusa-store-settings`, you release that repository, and only then does the app pin the new version. Plan the work in that order, because the app cannot use a card that is not released.
