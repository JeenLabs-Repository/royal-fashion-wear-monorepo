# 0013 Staff Dashboard Shell Reads

Status: accepted

Date: 2026-11-25

## Context

The Medusa dashboard cannot hide menu entries per role, and it calls a few admin endpoints while it loads. The permission manifest denies by default, so a role without the matching permission would see a dashboard that fails to load. We measured which reads each role's dashboard makes and decided which of them are safe to allow for every signed-in staff user.

## Decision

A read is mapped to the `self` permission only when all of these hold.

- It is a GET.
- It appeared for every probed role (order router, support, finance read-only and catalog approver) while the dashboard loaded, or it was already required for MFA enrolment (spike findings for Profile and Security).
- Its response exposes no customers, orders, products, prices, users, integration options, API keys, notification content or vendor data.

Store name, currency list, feature flags and plugin names qualify. Everything else keeps its normal permission, so pages that show business data keep answering 403 to roles without the permission. A non-GET is never mapped to `self`.

The measured paths, the roles that hit them, the content class of each response and the decision follow. The probe ran on 2026-11-25 through the saved browser spec, which also checks that no response is a server error and that no page renders blank.

| Path | Roles that hit it | Response content | Decision |
|---|---|---|---|
| `/admin/feature-flags` | order_router, support, finance_readonly, catalog_approver | Feature flag name map only | Map GET to `self` |
| `/admin/regions` | all four probed roles | Regions with currency and countries | Leave denied (commerce geography, not shell-only) |
| `/admin/sales-channels` | all four probed roles | Channel id, name, description | Leave denied (store structure) |
| `/admin/staff` | all four probed roles | Staff emails, roles, MFA state | Leave denied (user directory) |
| `/admin/staff/break-glass-reviews` | all four probed roles | Break-glass review rows | Leave denied (sensitive governance) |
| `/admin/orders` | catalog_approver only | Orders list | Leave denied (business data; role lacks permission) |
| `/admin/stores*` | (shell; mapped before probe) | Store name and currencies | Keep GET `self` |
| `/admin/layouts*` | (MFA enrolment shell) | Layout configuration | Keep GET `self` |
| `/admin/modules` | (MFA enrolment shell) | Module names | Keep GET `self` |
| `/admin/search-indexes` | (MFA enrolment shell) | Index metadata | Keep GET `self` |
| `/admin/notifications*` | (MFA enrolment shell) | Notification bell payload | Keep GET `self` |
| `/admin/cloud/announcements*` | (MFA enrolment shell) | Cloud announcements | Keep GET `self` |
| `/admin/users/me`, `/admin/staff/me` | signed-in identity | Current user / staff summary | Keep GET `self` |

## Consequences

A low-privilege role sees the dashboard shell load, and business pages answer 403 from the API. The custom Staff and Audit log pages show a clear no-access state from that 403. Each path mapped to `self` is readable by every signed-in staff user, including a user with no role, so a new row needs the same content check.

Rerun the probe after a Medusa upgrade or after adding an admin page, because the dashboard can start reading new endpoints.

Undo cost: reversible, because the mapped paths are lines in one file and the probe is saved as a spec.

## Alternatives Considered

- Map every shell read to `self`. Rejected because a read can expose business data.
- Leave every shell read denied. Rejected because the dashboard then fails to load for low-privilege roles.
- Hide menus per role. Rejected because the dashboard does not support it without the licensed edition or custom chrome.
- Map regions and sales channels to `self` because every role hits them. Rejected for this probe: responses hold commerce geography and channel structure beyond the allowed shell content class.
