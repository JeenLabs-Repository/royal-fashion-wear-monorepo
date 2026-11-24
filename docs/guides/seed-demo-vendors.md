# Seed Demo Vendors

This guide creates five demo vendors in your development database so you can try the vendor portal, the vendor API and the Admin vendor screens without inviting anyone by hand. The seed refuses to run in production.

## Before You Start

Start the dev stack, run the migrations and run the starter data seed first, so the store has a default sales channel. You also need the staff demo seed if you want to sign in to the Admin.

## Run the Seed

```sh
pnpm -C apps/backend exec medusa exec ./src/scripts/seed-vendors.ts
```

The command prints the vendors it created, the path of the credentials file and the path of the seed manifest. A second run prints that there is nothing to create and gives every unregistered vendor a fresh invitation link.

## What the Seed Creates

| Vendor | State | Use it for |
|---|---|---|
| Demo Vendor Alpha | active, locations in Maharashtra and Karnataka | everyday portal and API checks |
| Demo Vendor Bravo | active, one location in Delhi | checking that one vendor never sees another |
| Demo Vendor Charlie | registered, agreement not accepted | the onboarding checklist |
| Demo Vendor Delta | suspended | the suspension message |
| Demo Vendor Echo | invited, not registered | the accept invitation screen |

Every vendor location is an opaque stock location named like `LOC-0001`.

## Arguments

- `--fresh-invite` adds one more invited vendor named Demo Vendor Echo followed by a number, and writes its link.
- `--reset` removes every demo vendor, its users, locations, stock locations and sign-in identities.
- `--out-dir <dir>` writes the credentials file and the manifest under that folder instead of the repository root. The automated tests use it.

## Where the Credentials Go

The seed writes a section between the markers `<!-- vendor-seed:start -->` and `<!-- vendor-seed:end -->` in `TEST-CREDENTIALS.local.md` at the repository root. It replaces only that section on a rerun and leaves the rest of the file alone. It also writes `e2e/.auth/vendor-seed.json` for the browser specs. Git ignores both. The seed stops before it creates anything when git does not ignore the credentials file.

The passwords are fake development values. Add any TOTP secret you create while testing under "MFA secrets" in the credentials file by hand.

## Reset the Demo Data

1. Run the seed with `--reset`.
2. Run the seed again without it.

The reset leaves the audit log as it is.
