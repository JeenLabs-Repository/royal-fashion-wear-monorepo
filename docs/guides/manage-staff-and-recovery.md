# Manage Staff and Recover Access

This guide is for the store owner. It shows how to invite a staff member, give them a role, read the audit log and handle a break-glass alert. For lost access, follow the recovery runbook.

## Invite a Staff Member

1. Open Settings > Users in the Admin.
2. Choose Invite and enter the person's email address.
3. Send the invite. The person opens the link and sets a password.

A new user sees nothing yet. Every Admin call answers that they have no role until a superadmin assigns one.

## Assign a Role

1. Open Staff in the Admin sidebar.
2. Find the person and choose Manage roles.
3. Pick a role, then choose Assign role.

Roles take effect on the person's next request. A person can hold several roles unless one of them is superadmin, which stands alone. The page shows the server's message when a change is not allowed, for example when it would remove the last superadmin.

To take a role away, open Manage roles and choose Revoke next to it.

## Set Up Two-Step Sign-In

Every staff member sets up a TOTP authenticator under Profile > Security before any Admin screen works. Until they do, the screens load but show no data. Recovery codes appear during setup. Save them somewhere safe, because they are the way back in when the authenticator is lost.

## Read the Audit Log

Open Audit log in the sidebar. Only a superadmin can see it.

- Filter by date range, actor, action prefix such as `staff.`, or target id.
- Choose Details to see the before and after values of a row.
- Choose Load more to page through older rows.

The log cannot be edited or exported. The database rejects any change to a row.

## Handle a Break-Glass Alert

The break-glass account is the sealed account for emergencies. When someone uses it, you receive an email and a banner appears on the Orders and Products pages for superadmins. Do the following.

1. Open the Audit log and filter the action prefix `break_glass.` to see what happened.
2. Ask a technical contact to rotate the credentials with the server command in the recovery runbook, and seal the new ones.
3. Open Staff, choose Close review, tick the confirmation that the credentials were rotated and write a note of at least 10 characters. A different superadmin than the break-glass account must close the review.

An unclosed review sends a reminder email every morning at 09:00 IST after 24 hours.

## Remove a Staff Member

Delete the user under Settings > Users. Their old sign-in stops working on the next request. To cut someone off before you delete them, revoke their roles on the Staff page.

## Lost Access

If every superadmin password is lost, follow [Recover Staff Access](../runbooks/staff-recovery.md). It covers the sealed break-glass credentials and the server command that creates a new superadmin.

## Decisions Still Open

Two decisions belong to you and block the production release checklist, not day-to-day use.

- Who holds the sealed break-glass credentials.
- Which email addresses receive the break-glass alert. Set them in `BREAK_GLASS_ALERT_EMAILS`.
