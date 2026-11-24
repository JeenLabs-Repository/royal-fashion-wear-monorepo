# Recover Staff Access

This runbook explains how to regain Admin access when staff passwords are lost, how to rotate the break-glass account and how to remove a staff member. The recovery scripts run on the server, so you need shell access to the backend.

## Who Can Run This

Only a person with a shell on the backend server can run the scripts. That access is already full trust, so every script writes an audit entry with the actor `cli:<operating system user>`.

Two owner decisions are still open and block the production release checklist, not the build.

- Who holds the sealed break-glass credentials.
- Which addresses receive the break-glass alert. Set them in `BREAK_GLASS_ALERT_EMAILS`.

## Before You Start

- Run every command from the repository root. The scripts read the same `.env` as the backend.
- The backend can stay up while a script runs.
- Passwords print once to the terminal. They never go to the logs, the audit table or any email. Store the output at once and clear the terminal history afterwards.
- A user made with the stock `medusa user` command has no staff role and is denied everywhere. Use the scripts below instead.
- In development, the demo admin `admin@example.test` from the test data seed gets the superadmin role when you run `seed:staff-demo`. The script refuses to run in production, so this grant never reaches a production database.

## Scenario A Regain Access With the Sealed Break-Glass Credentials

Use this when every admin password is lost and the sealed envelope is available.

1. Open the envelope. It holds the break-glass email, its password and its TOTP recovery codes.
2. Sign in to the Admin with that email and password.
3. At the two-step prompt, enter one recovery code. Treat every recovery code as single use and cross it off.
4. Expect the break-glass alert email within a few minutes. The first request in any 15-minute window sends it and opens a review.
5. Under Settings > Users, invite or reset a normal superadmin. Assign roles on the Staff page.
6. Close the review on the Staff page. You need a different superadmin for this, a confirmation that the credentials were rotated, and a note of at least 10 characters.
7. Rotate the break-glass account with Scenario C and seal the new credentials.

## Scenario B Regain Access From the Server Shell

Use this when the sealed credentials are not available.

1. Create or recover a superadmin.

   ```sh
   pnpm --dir apps/backend run staff:grant-superadmin -- <email> reset-password
   ```

   The script creates the user and sign-in identity when they are missing, removes other roles, assigns superadmin and prints a one-time password. Without `reset-password` an existing account keeps its password.
2. Sign in to the Admin with the printed password.
3. Set up TOTP under Profile > Security before anything else. Until you do, every Admin call answers `mfa_enrollment_required`.
4. Assign normal roles to the other staff on the Staff page.
5. Create a fresh break-glass account.

   ```sh
   pnpm --dir apps/backend run staff:create-break-glass -- <break-glass email>
   ```

   Seal the printed password, then sign in once to enrol TOTP and seal the recovery codes with it.

## Scenario C Rotate the Break-Glass Credentials

Run this after every break-glass use and on a routine schedule.

```sh
pnpm --dir apps/backend run staff:rotate-break-glass
```

The script sets a new random 24-character password, removes the account's MFA factors and prints the password once. The next sign in must enrol TOTP again, and that first use sends the expected alert. Replace the sealed copy and close the open review.

## Check the Roster

```sh
pnpm --dir apps/backend run staff:list
```

The script prints each user with roles, the break-glass flag and the MFA state. It never prints a secret. It writes an audit entry that holds only the row count.

## What the Alert Depends On

The alert is an email, so it depends on SMTP and on the app being up. Two fallbacks exist until more alert channels are added.

- The ERROR log line `[break-glass] USED`.
- The audit row `break_glass.used`.

Watch the logs and the Audit log page when the mail provider is down.

## Removing A Staff Member

Delete the user under Settings > Users. Deleting is the offboarding step. There is no suspend.

- The next Admin request that carries the person's old cookie session or access token is refused with 401 `staff_user_not_found`. The server checks that the user still exists on every request, even when role assignments remain.
- The old token stays cryptographically valid until it expires. The access token lasts 1 day and the cookie session lasts 8 hours. It authorises nothing on Admin routes, and routes outside the Admin area accept no staff role from it.
- To cut a person off before you delete them, revoke their roles under Staff. That applies on their next request, so you do not wait for a token to expire.
- You cannot delete the break-glass account or the last non-break-glass superadmin.

## Drill Log

The drill is rehearsed on a restored copy of the database. Add one row per passing run.

| Date | Operator | Environment | Scenario | Commands run | Result | Notes |
|---|---|---|---|---|---|---|
