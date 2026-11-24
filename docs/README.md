# Documentation

This folder holds the reference documentation for the repository. Cursor and Claude read it directly, so keep it accurate.

## Folders

- `guides/` holds task-focused how-tos. Each guide starts from a goal and ends with what you should see.
- `concepts/` holds explanations of how and why something works.
- `decisions/` holds short records of key choices, so nobody undoes a decided choice by accident.
- `testing/` holds test conventions. It is added with the test tooling.

## Writing Rules

- Use active voice and second person.
- Do not use em dashes or asides set off with a pair of them.
- Use a colon only before a list that sits on its own lines.
- Write headings as statements in Title Case, never as questions.
- Never write a phase, plan, task, decision or requirement number into a document. A guard in CI fails the build when one appears.

## Keep Docs With Code

Update the documentation in the same change as the code it describes. A change that alters a command, a variable or a behavior is not done until the matching guide, concept page or record says the same thing.
