@AGENTS.md

# Project rules (Claude)

`AGENTS.md` above is the starter's own guide: structure, commands, conventions, silent breakages. Follow it. Where it conflicts with this file, **this file wins**, because the starter's guide is written for a template that shop owners copy. In this project the `supersecret` defaults, the Node 20 allowance, pnpm-only neutrality and the 36-language demo scope are not acceptable to ship.

Read `PRODUCT.md` (repo root) before any design or copy work. Read `docs/` and the decision records before changing an area they cover.

## What this is

A multivendor store for India on the Gorgo Medusa DTC Starter (Medusa 2.22.7, Next.js 15). Customers see one store brand and only the **state** a product ships from, never the vendor. The owner receives every order and **manually** routes each line to a vendor location, preferring the customer's state. Vendors have a separate login and portal. Payouts are manual and out of scope.

## Always

1. **Check local skills first** (project files, not the web). If one covers the task, read its `SKILL.md` and follow it before writing code:
   - `apps/backend/**`: `.claude/skills/building-with-medusa`
   - `apps/storefront/**`: `.claude/skills/building-storefronts` and `.claude/skills/storefront-best-practices`
   - Admin widgets and pages: `.claude/skills/building-admin-dashboard-customizations`
   - Migrations: `db-generate`, `db-migrate`
   - Visual design: use **either** `impeccable` **or** `design-taste-frontend` for a task, never both
2. **Loop per change:** write code, test, find bugs, fix, retest, **retest in a real browser with automation** (Playwright), check how the UI looks and fix it with the design skill, retest everything, then update docs.
3. **Pin versions.** Medusa packages stay at exactly 2.22.7 and `@gorgo/medusa-integration` stays pinned. Do not upgrade Medusa. Node is 22.23.4 or later.

## Git

- You work **only on `active-dev`**. Never push to `dev` or `main`, never merge to `main`, never force-push. The owner promotes work.
- **Conventional Commits**, short and plain: `feat: add vendor invite route`. Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
- **No plan, phase, task or requirement numbers anywhere in git** (branch names, messages, bodies, PRs, comments). The planning docs are not in this repository, so such references point at nothing. Name things by what they are.
- **Every commit is signed.** Never use `--no-gpg-sign` or `-c commit.gpgsign=false`. If signing fails, stop and tell the owner.
- One logical change per commit, and each commit builds on its own. Backend changes land before the storefront changes that depend on them. Fix with `git commit --fixup` and `rebase --autosquash` before promotion.
- Commit format: `<type>[scope]: <summary>`, imperative and lowercase, no trailing period, about 72 characters or fewer; scope names code (`vendor-api`, `storefront`), never a number; the body explains why. Good: `fix(storefront): stop caching authenticated cart requests`. Bad: `feat(1-0): vendor stuff`, `wip`, `update`, `fixes`.
- After committing, `git log --show-signature -1` should show a good signature. If signing fails, stop and tell the owner.
- Formatting-only changes get their own commit. Never commit secrets, `.env` files or `TEST-CREDENTIALS.local.md`. Never use `--no-verify`.
- Squash fixups without an editor: `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <base>`, only on `active-dev` commits that have not been promoted. Never rewrite `dev` or `main`.
- Commit or push only when the owner asks.

## Anonymity (the core rule)

The customer must never learn which vendor supplies anything. That includes pages, JSON-LD, sitemap, `llms.txt`, RSC payloads, the Store API, emails, invoices, packing slips, courier labels, tracking pages and return labels.

- No vendor name, vendor SKU, handle, `metadata`, image path or EXIF, or real stock-location name on anything customer-facing. SKUs and handles are assigned by the platform. Locations are named opaquely (`LOC-0042`). Images are re-encoded and stored under random keys.
- **No module links** between vendor data and commerce models; use plain ID columns. A Store API `fields=` expansion could otherwise reach vendor data.
- Every vendor, store and document response goes through an **allowlist serializer** (`src/lib/serializers/`). A guard on `/store*` rejects forbidden `fields` and `expand` terms.
- A **canary test** seeds distinctive vendor strings and fails if any appear in customer-facing output. Keep it passing and extend it for each new surface.
- Vendors never see customer email, phone, order totals or other lines. They get the assigned items and the shipping name, address, PIN and state only.

## Backend (Medusa)

- Custom modules: `vendor`, `vendorCatalog`, `orderRouting`, `documents`, `staffAccess`, `auditLog`. Modules are CRUD; business rules live in **workflows**; routes stay thin.
- **Vendors are a custom `vendor` actor type**, never Admin users. `vendor_id` comes from `auth_context.app_metadata`, **never from request input**. Use strict zod schemas (no mass assignment) and an ownership check on every vendor route. A suspended vendor loses access on the next request.
- **Staff RBAC is custom** (Medusa's RBAC and audit modules need a paid licence): every `/admin*` route is denied unless listed in the permission manifest; unlisted routes need superadmin. `/admin/integrations*` and Settings → Integrations are superadmin only and refuse secret API keys. MFA (core TOTP) is forced for staff and vendors. The audit table is append-only, enforced by a database trigger.
- **Order routing is manual.** The reservation must follow the assignment (move or split it), every fulfilment passes an explicit `location_id`, and a job checks for drift. Do not assume Medusa's reservation behaviour; spike it before writing routing code.
- **Payments:** Razorpay through our own provider. The webhook completes the order independently of the browser, verifies the signature on the raw body and ignores duplicate event IDs. Refunds carry an idempotency key. Amounts go through one tested `toPaise()` helper. The default system payment provider must not be enabled in the India region.
- **GST:** one India region, tax-inclusive prices, rates by product type. Invoice numbers come from a gapless per-GSTIN, per-financial-year sequence, never from the order display id. Invoices are immutable snapshots. Render PDFs with `pdfmake` and a font that has the rupee glyph. Seller of record and invoice timing are accountant decisions; keep them configurable.
- Do not put non-subscriber helpers under `subscribers/`, and do not modify the Gorgo module's own code.

## Integration Module

Every provider this project adds exposes its settings through the Gorgo Integration Module (Settings → Integrations). Cards to build: Razorpay; GST and owner legal identity; SMTP (wrapper); document and invoice settings (issue point, number format and series prefix, logo and footer text, packing-slip text); customer-facing identity and return policy (sender name, owner return address, masked-phone policy); vendor onboarding settings (invite expiry, agreement version); routing preferences (same-state-first, aged-order hours, reminder timing). Adopted third-party plugins get a wrapper descriptor; a plugin without one is not adopted. Not in the module: courier, WhatsApp/SMS, staff alert channels (alerts go by email), the vendor compliance plugin (KYC, vendor GSTIN, bank details), built later, file storage, error-tracking DSN, search settings, security policy. Each provider: a descriptor with `secret: true` **and** `control: "secret"` on credentials, `minLength: 1` on required strings, and a `testConnection` where possible. Read options **at call time**, never in a constructor. Bootstrap secrets stay in env: `DATABASE_URL`, `INTEGRATION_ENCRYPTION_KEY`, `JWT_SECRET`, `COOKIE_SECRET`, the MFA key, Redis URL, CORS lists, provider registration. The encryption key must be identical on every process. Set `GORGO_DISABLE_TELEMETRY=true`.

## Storefront and vendor portal

- No `force-cache` on any request that carries authorization. Verify with a two-customer test.
- No secrets in `NEXT_PUBLIC_*`. Address lookup goes through a backend route using the bundled India Post PIN directory; no DaData.
- `next build` runs typecheck and lint and must pass. Do not re-add `ignoreBuildErrors` or `ignoreDuringBuilds`.
- The vendor portal is a static Vite + React **18.3** app (not 19, because `@medusajs/ui` peers on 18), built in CI and served as static files. No extra Node server.

## Testing and environments

- Browser flows are **Playwright specs saved in the repo**, not ad-hoc clicking. Add or update one with every UI change.
- Create every field value needed for testing yourself, using obviously fake demo data (accounts for each role, form inputs, vendor and product details, addresses with valid Indian state and PIN pairs, orders, settings-card values), and record all of it in the untracked `TEST-CREDENTIALS.local.md` (in `.gitignore` before it exists) so the owner can check it and reuse it in manual testing. A seed script creates the baseline set; append what else a test needed, with what it is, which flow created it and how to reset it. Values you cannot invent (Razorpay test keys, real SMTP credentials) go under "owner to provide"; in dev send email to a local mail catcher. Never real or production data.
- Backend suites: `test:unit`, `test:integration:http`, `test:integration:modules` from `apps/backend`. Vendor isolation has a generated cross-vendor matrix test; every new `/vendor/*` route must be covered.
- After dev testing, run the **production build** (`medusa build`, `next build`) and test there too, GUI included. If the build fails, fix and rebuild. CI runs lint, typecheck and both builds on every push. The server never builds; it pulls images.
- Dev credentials are never used in production. Razorpay stays in test mode until one final small live payment. `gitleaks` runs in a hook and in CI.

## Docs

Write Markdown reference docs in `docs/` in the same change as the code, in the style of the Medusa docs (task guides plus concept pages). Record key choices as short decision records.

## Decisions already made (do not reopen without asking the owner)

- One customer order, no split carts (splitting per vendor would reveal several vendors). Routing is manual; no automatic nearest-vendor logic.
- Vendors are a custom actor type, not Admin users. Vendor data is never linked to commerce models; responses go through allowlist serializers.
- Staff RBAC is custom because Medusa's RBAC and audit modules need a paid licence with an online check, which conflicts with an offline break-glass account. Core TOTP MFA is forced for staff and vendors.
- Razorpay through our own provider (Stripe India is invite-only; community Razorpay plugins are pinned to old Medusa). GST uses Medusa's native tax rules; invoices are issued in the owner's name, final rules pending an accountant.
- Redis stays (without it sessions fall back to memory). Dokploy was chosen by the owner, with at least 4 GB RAM, the panel behind a VPN or allowlist, a patched version and builds in CI. Medusa stays pinned at 2.22.7; 2.23 is a later, separate upgrade.
- Out of scope: vendor payouts and commission, cash on delivery, WhatsApp and SMS (later, as their own Integration Module provider), a dedicated search engine, a separate SSO server.
- The vendor portal is a static app, not another server. The app server is self-hosted with 4 cores, 8 GB RAM and 100 GB storage and runs Dokploy, the backend, the storefront and Redis; Postgres runs on a separate owner-operated host over a private network, never exposed to the internet (plan for Postgres 17, keep the version a variable). Prefer no new services and measure memory before launch.

## Do not guess; ask the owner

Seller of record and GST invoice rules (which state decides CGST and SGST versus IGST, invoice per dispatch or per order); Legal Metrology declarations (they conflict with anonymity); launch categories; brand name; return address policy; courier aggregator and who books; languages beyond English; the SSH signing key; a docs site. Keep these configurable and flag them rather than choosing.

## Build order (earlier areas unblock later ones)

Baseline hardening and India scope cut, then repository tooling; staff governance (roles, MFA, audit, break-glass); vendor domain with the scoped API and anonymity tests; catalog and per-location stock; India commerce (payments, GST, PIN lookup) can run alongside those; manual routing and fulfilment; documents, returns and notifications; launch readiness. Do not build a vendor screen before the scoped API and serializers exist, and do not build approvals or routing before staff roles and the audit log exist.

## Spikes before depending on them

Where Medusa places a stock reservation when several vendor locations share a channel, and whether it can be moved or split on assignment; whether fulfilment with an explicit vendor `location_id` works with a single hub shipping option; whether a custom `/admin*` middleware can see the signed-in user and reject core and plugin routes; whether the payment webhook completes a cart on 2.22.7. Record each result as a short decision record in `docs/`.

## Branches, promotion and pull requests

- `main` (production), `dev`, `active-dev`. You work only on `active-dev`. The owner promotes: `active-dev` to `dev` by a signed `--no-ff` merge after tests, Playwright specs, the visual check, docs, lint, typecheck and both builds pass and fixups are squashed; `dev` to `main` only through a pull request the owner opens by hand, using the **"Create a merge commit"** method (squash and rebase merges create commits the owner's key did not sign). Tag releases with signed tags.
- Before the owner opens the PR, the production build is run from `dev` and tested (GUI included). When asked, draft the PR notes from the commits and diff only, with no plan references: Summary; Backend changes; Storefront changes; How it was tested (commands, Playwright run, production-build result); Migrations (back up first; keep them backwards-compatible); New or changed environment variables and secrets; Rollback plan; Known risks; Screenshots.
- A hotfix branches from `main`, goes through a PR, and is merged back into `dev` and `active-dev` immediately. After every release merge `main` into `dev` and `dev` into `active-dev`.
- Enforced by tooling: a commit-msg hook (commitlint) rejecting non-conventional messages and any plan numbering; SSH commit signing; `gitleaks` in a hook and CI; CI running lint, typecheck and both builds on every push; protected `main` and `dev` (no direct or force pushes, required checks, signed commits).
- Storefront and backend change together, so expect many small commits on `active-dev` while fixes land.

## Versions and releases

Plain semver on signed annotated tags: `v0.x` before launch, `v1.0.0` at launch, then one major number per product stage (v2, v3, v4); there are no outside API consumers, so a major number marks a stage. Minor releases are smaller feature or maintenance releases (for example the dependency upgrade) and patch releases are fixes. Tag text describes changes in words. The changelog is generated from conventional commits. No API versioning (backend and vendor portal deploy together). Pin dependencies exactly with a committed lockfile and no `latest` or `^`; upgrade one thing at a time on `active-dev` with the full suite. The Medusa 2.23 upgrade is its own later release. Dependency bots may propose patch updates but never auto-merge.

## Vendor module is plugin-ready; no KYC in core

Vendor KYC, vendor GSTIN and bank details are not built now. They arrive later as a separate plugin, so never add PAN, GSTIN, bank or KYC fields to any core model. The owner activates vendors by hand. Build the vendor module with these extension points: workflow hooks on vendor activation, location create or update, and suspension (plugins register handlers; the base never imports a plugin); plugin-owned data keyed by plain `vendor_id` and `vendor_location_id`, never module links; public utilities a plugin can import (vendor auth middleware, ownership helper, allowlist serializer helper, an audit call); a place for plugin sections on admin vendor pages; and a vendor onboarding steps list that holds only agreement acceptance for now. Cover the activation hook with a test-only stub plugin that blocks activation. Verify the hook and admin-extension mechanics on 2.22.7 with a small spike before relying on them. The owner's own GST (tax region, invoices) is unaffected.

## Plugin repositories

Gorgo plugins this project creates each live in their **own repository** (three repos: a Razorpay payment provider, a store-settings plugin holding every settings card, and later a vendor compliance plugin). The app depends on them by exact pinned version from a private registry, installed from signed tags. Plugins import nothing from the app's internals and expose a documented public surface. Each plugin repo follows the same three branches, commit rules, signing, CI and docs as the app repo.

## Access, audit and break-glass

Every `/admin*` request re-checks that the actor still exists in the User module before any role assignment is read (401 `staff_user_not_found`, 500 `staff_lookup_failed`; no cache, no exemption, break-glass included); a deleted user's old token or cookie authorises nothing even if an assignment row remains. The vendor chain also checks vendor status on every request. A route is allowed only if the permission manifest lists it; unlisted `/admin*` routes need superadmin; API keys are refused on admin routes. Every non-GET `/admin*` request is audited (key names only), including core-handled and bypassed routes; recovery scripts audit too; the audit table is append-only by trigger. Revoking a role and deleting a user share one lock so the last superadmin cannot be removed; test both orders. Break-glass use alerts once per window (atomic lock acquire, 900 seconds, unique open-review index, notification idempotency key). If a recorded spike says STOP, halt and tell the owner.

## Documents, GST and returns

Never invent owner or accountant decisions: the invoice issue point has no default; incomplete supplier identity stops invoicing and alerts staff; the CGST and SGST versus IGST rule, HSN and seller of record stay configurable; never pass a vendor's state to the tax function. Every reason that makes issuing skip an order alerts staff (issue point not set, supplier incomplete, missing HSN, missing ship-to state, amount not representable); only not due, order canceled and nothing to invoice are silent. The catch-up job runs oldest first (50 issued, 200 attempted per run); a daily backlog alert at 09:00 IST reports old uninvoiced orders; a script invoices named orders at any age. Numbering is gapless (series row locked in the insert transaction) and invoices are immutable snapshots; credit notes are retry-safe through the refund-reference intent table; amount columns are 32-bit with a guard. Shipped lines cannot be cancelled (core cancel route guarded, 409); returns go to the owner's address, never the vendor; guests contact support. The packing slip comes from an owner-only type with no vendor field; every email template belongs to a per-audience allowlist with a completeness test; PDFs and email metadata are canary-tested.

## Vendor labels and routing

Vendor routes use the assignment reference as the id, never an internal id. A staff-uploaded label is released to a vendor only when the masked phone policy is `none`; under `courier_label_only` release is refused in the release workflow, the upload route and the vendor label route (re-checked on every request, same 404 as any refusal). Routing candidates are limited to the vendor that owns the variant (one vendor per product at launch).

## Plugin pins and the registry secret

Install plugins by exact version from the private registry, never by file, link or local-publish path in committed config. The registry token reaches installs and image builds only as a secret mount: optional and safe when unset until the first plugin dependency lands, required in the same commit that adds it, enforced by a guard. A plugin is released from a signed tag by its own CI, then the app's pin is bumped in a separate commit. Zero-total orders cannot complete once the default system payment provider is removed; this is an open owner question: add no completion path and keep the test that pins the behaviour.

## Launch gates and test data

Never tick or pass an owner gate: accountant and lawyer sign-off, Razorpay live approval and a real live payment and refund, courier masking in the live dashboard, UAT, the physical parcel and return, the forced-failure monitoring drill, and the soft launch. UAT results record the 40-character build commit, checked against the release candidate with `git diff --name-only --no-renames`, matching only slash-terminated `docs/launch/` and `docs/runbooks/`. Test data never enters the production database: load, UAT, parcel, restore and end-to-end runs use separate databases; at go-live the proof is read-only. Every check you write must fail before the change and pass after it; no exact `grep -c` counts of 2 or more; no check may pass when its tool did not run; tests that need a missing owner input skip and report not run.

