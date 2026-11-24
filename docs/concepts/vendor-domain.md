# How the Vendor Domain Works

This page explains the vendor models, the lifecycle of a vendor and the rules that keep vendors hidden from customers.

## Models and Statuses

The vendor module stores vendors, vendor users, locations, invitations, agreement acceptances and a counter for location codes. A vendor has one of three statuses. It starts as `invited`, becomes `active` when the owner activates it and becomes `suspended` when the owner suspends it. A vendor never returns to `invited`.

The vendor is the tenant. The vendor user is the person who signs in. The model allows several users per vendor, and every request finds its vendor through the signed-in user, never from the request.

## The Lifecycle

```text
invited -> registered -> agreement accepted -> activated -> suspended -> reactivated
```

1. The owner invites a vendor. The workflow creates the vendor, one user and a single-use invitation.
2. The vendor opens the link, sets a password and registers. This is the only way a vendor sign-in identity is created.
3. The vendor accepts the agreement and packing guideline in the portal.
4. The owner activates the vendor. Activation needs a registered vendor and every required onboarding step complete, and a plugin can block it.
5. The owner can suspend a vendor with a reason of at least ten characters. Suspension applies on the vendor's next request.
6. The owner can reactivate a suspended vendor with a reason. The activation hook runs again.

## Invitations

The invitation token is 32 random bytes. Only its SHA-256 hash is stored. The link carries the token in the URL fragment, which the browser never sends to a server. One database update consumes a token, so two simultaneous attempts produce one success. A resend expires every earlier token. An email that already has any sign-in identity cannot be invited.

## Locations and the Sales Channel

Each vendor location is a Medusa stock location. Its name is an opaque code such as `LOC-0001` and its address holds only the country and the state. The location is linked to the sales channel only while the vendor and the location are both active, and the links are rebuilt from that rule whenever a status changes.

## Eligibility

A vendor may list products only while it is active and has accepted the current agreement version. One function, `assertVendorEligible`, answers this for the catalog routes. When the agreement version changes, the agreement step opens again for every vendor.

## Settings

The invitation expiry and the current agreement version come from a settings reader that returns safe defaults when no settings card exists. The settings card pages describe the card contract.

## No Vendor Tax, Bank or Identity Data

The vendor module holds no tax number, bank detail or identity document. A CI guard parses the vendor models and migrations and fails the build when a column matches. A compliance plugin keeps such data in its own module with a plain vendor id.
