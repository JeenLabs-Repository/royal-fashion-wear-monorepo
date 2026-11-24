# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Three audiences, all using web interfaces:
- **Shoppers** in India buying from one store brand, on mobile and desktop. They see only the state a product ships from and never learn which vendor supplies it.
- **Vendors**: invited suppliers with one or more locations. They sign in to a separate vendor portal to draft products, update stock per location (including bulk CSV upload) and fulfil orders routed to them. They never see customer email, phone or order totals, only the assigned items and a shipping name, address, PIN and state.
- **Owner and staff**: the owner receives every order and routes each line to a vendor location by hand, preferring the customer's state. Staff work in the Medusa Admin under roles (superadmin, catalog approver, order router, support, finance read-only) to approve vendor products, route orders and handle returns.

## Product Purpose
A multivendor store for India built on the Gorgo Medusa DTC Starter (Medusa 2 backend, Next.js 15 storefront). Customers buy from a single store brand and the vendors stay anonymous. Success means a shopper can browse, pay and receive an order with no sign of the vendor, while the owner can route every order to the right vendor location and vendors can fulfil it. Launch categories (fashion and apparel was the starting assumption), brand name and success metrics are not yet defined.

## Positioning
An anonymous-vendor store: one visible brand, many hidden suppliers, and a human (the owner) who routes each order. A marketplace that names its sellers cannot truthfully copy this. Who is the legal seller of record is undecided and needs accountant and lawyer review.

## Operating Context
- Planning only so far; implementation is handed to Cursor and Claude Code, coded in a git repository (planning documents are not committed).
- India only. Self-hosted on the owner's own server with Dokploy, images built in CI.
- Orders go to the owner first; routing is manual. Vendor payouts are handled manually outside the system.
- Accountant review (GST seller of record, invoicing) and lawyer review (Legal Metrology declarations, consumer and data-protection rules) are pending and block invoice and listing work.
- The owner's workflow: local skills first, browser-automation retests, dev branch work promoted through `dev` to `main` by pull requests the owner opens.

## Capabilities and Constraints
- Stack stays: Medusa 2.22.7, Next.js 15, pnpm, Turborepo; vendor portal is a static Vite and React app; Node 22.23.4 or later.
- Planned: Razorpay payments, GST tax region with tax-inclusive prices, GST invoices issued in the owner's name, bundled India PIN lookup, email notifications. WhatsApp and SMS alerts are deferred.
- All plugin settings are configured through the Gorgo Integration Module (Settings → Integrations).
- Staff access is custom role-based access with forced MFA, an append-only audit log and a break-glass account.
- Terminology: **vendor**, **vendor location**, **routing** (owner assigns an order line to a vendor location), **"Ships from {State}"**, **owner**, **staff**.
- Hard rule: vendor identity must never reach a customer, on any page, email, invoice, packing slip, label or tracking page.
- Resource-light: at least 4 GB server, avoid extra services.
- Undecided: brand name, launch categories, which Indian languages beyond English, courier aggregator, return address policy, seller of record.

## Brand Commitments
No brand name or identity confirmed. One binding commitment: the store's own brand is the only sender and seller shown to customers (invoice, packing slip, labels, emails), and the vendor is never named.

## Evidence on Hand
Only the starter's seed data and demo content. No brand assets, product photography, copy, vendor list, product catalogue, legal or accounting opinions, or analytics exist yet. Future work must not invent them.

## Product Principles
- Anonymity first: every customer-facing surface is checked for vendor leaks before it ships.
- The owner stays in control: approvals, routing and integrations settings are deliberate human steps.
- Vendors get exactly what they need to fulfil an order and nothing more.
- Keep the starter's architecture and extend it rather than replacing parts; keep it light on resources.
- Leave brand, market, legal and provider decisions explicit until confirmed; treat demo content as placeholder, never as brand truth.
