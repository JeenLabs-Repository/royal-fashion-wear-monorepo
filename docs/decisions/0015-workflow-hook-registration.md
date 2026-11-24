# 0015 Workflow Hook Registration

Status: accepted

Date: 2026-11-25

## Context

A later compliance package must be able to attach to vendor workflows without the vendor module importing it. That needs a handler registered from outside the module that can stop the parent workflow. This record states how Medusa 2.22.7 behaves.

## Observed

### E10 Hook Mechanics

Request: `POST /spike/run` with the handler flag off and on, `GET /spike/run?direct=1`, and a Jest HTTP spec that registers its own handler.
Observed: form (a), a file under `src/workflows/hooks`, is discovered at boot.
Observed: form (b), a handler registered at the top of a Jest spec, is discovered (with `DB_USERNAME`/`DB_PASSWORD` set for the integration runner).
Observed: form (c), a loader of a second module directory (`Module(…, { loaders: […] })`), is discovered at load time (boot log printed `[spike] loader registered the hook`).
Observed: with the flag off the run returned 200; with the flag on it returned 400 and the message `blocked by spike`.
Observed: the hook does run when the inner workflow is invoked through `runAsStep`, and does run when it is invoked directly.
Observed: a thrown `NOT_ALLOWED` gave HTTP 400; a thrown `INVALID_DATA` gave HTTP 400.
Observed: an earlier status-changing step was rolled back after the handler threw (`a` returned to `false`, `reached_c` stayed `false`).
Decision for the plans: A handler is registered by a file under `src/workflows/hooks` (production) or by calling `workflow.hooks.<name>(…)` from a second module loader or a Jest spec (tests); it is discovered at boot, load time or test time respectively; blocking works through runAsStep: yes; handler errors roll back earlier steps: yes; HTTP status: 400 for both `NOT_ALLOWED` and `INVALID_DATA`.

## Decision

The vendor workflows that expose hooks declare them directly, and the compliance package registers handlers from a second module loader (or `src/workflows/hooks` for in-app stubs). Tests register handlers at the top of the Jest HTTP spec before the runner boots.

## Consequences

The test that proves blocking uses the registration form that works at test time (Jest top-level `hooks.` call). The production plugin form is a module loader. Where only one form works, the vendor module documents that form as the only supported one; here all three forms worked.

Undo cost: reversible, because only code that follows this record depends on it.

## Alternatives Considered

- Events and subscribers instead of hooks: rejected because a subscriber cannot stop the parent workflow.
- Importing the compliance package from the vendor module: rejected because the base must never import a plugin.
