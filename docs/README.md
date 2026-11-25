# Documentation

This folder holds the reference documentation for the repository. Cursor and Claude read it directly, so keep it accurate.

## Folders

- `guides/` holds task-focused how-tos. Each guide starts from a goal and ends with what you should see.
- `concepts/` holds explanations of how and why something works.
- `decisions/` holds short records of key choices, so nobody undoes a decided choice by accident.
- `runbooks/` holds step-by-step procedures for operating the store, such as recovering staff access.
- `testing/` holds test conventions. It is added with the test tooling.

## Pages

- `guides/vendor-plugin-extension-points.md` explains how a compliance plugin attaches to the vendor module.
- `guides/seed-demo-vendors.md` creates demo vendors for development.
- `guides/add-a-canary-surface.md` explains how to register a new customer-facing output in the anonymity suite.
- `concepts/vendor-domain.md` explains vendors, locations, invitations and the sales channel rule.
- `concepts/anonymity-test-suite.md` explains the layers and the two end-to-end suites that protect vendor identity.
- `guides/vendor-portal-development.md` explains how to run, build, test and serve the vendor portal from the backend.

## Page Index

- [Develop the Vendor Portal](guides/vendor-portal-development.md) explains how to run, build, test and serve the vendor portal from the backend.

## Writing Rules

- Use active voice and second person.
- Do not use em dashes or asides set off with a pair of them.
- Use a colon only before a list that sits on its own lines.
- Write headings as statements in Title Case, never as questions.
- Never write a phase, plan, task, decision or requirement number into a document. A guard in CI fails the build when one appears.

## Keep Docs With Code

Update the documentation in the same change as the code it describes. A change that alters a command, a variable or a behavior is not done until the matching guide, concept page or record says the same thing.
