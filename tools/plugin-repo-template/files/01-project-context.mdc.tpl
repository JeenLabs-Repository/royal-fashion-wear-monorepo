---
description: What this repository is and how it relates to the store application
alwaysApply: true
---

`@@PACKAGE@@` is a plugin for a Medusa 2 store. It adds @@DESCRIPTION@@ and exposes one documented public surface that the store application installs.

The store application lives in a separate repository. You never edit it from here, and you never import anything from it. When a change needs an application edit, finish and release the plugin first, then tell the application owner to bump the pinned version.

You ship a release as a signed, annotated `v0.x` tag. The publish workflow verifies the tag and publishes the package to the private registry. You never publish from your own machine.
