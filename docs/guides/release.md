# Cut a Release

This guide takes you from a finished `active-dev` to a signed tag on `main`.

## Version Names

Use plain semver with a leading `v`. Use `v0.x.y` before launch, `v1.0.0` at launch, then one major number per product stage. Minor releases are smaller feature or maintenance releases. Patch releases are fixes, and security patches go out as patch releases. A version must match `v0.1.0` style numbers with no suffix.

## Steps

1. Finish the promotion checks from the branches concept page on `active-dev`.
2. Prepare the changelog on `active-dev`.

   ```sh
   pnpm release:prepare v0.1.0
   ```

   The script refuses unless you are on `active-dev` with a clean tree, a valid version, no existing tag and signing turned on. It writes the new section to `CHANGELOG.md` from the Conventional Commits since the last tag, checks the text for planning numbers and commits only that file.
3. Promote `active-dev` to `dev` with a signed `--no-ff` merge, and push `dev` as the owner.
4. Open a pull request from `dev` to `main` with the repository template. Merge it with the "Create a merge commit" method.
5. Switch to `main`, pull the merge and create the signed tag.

   ```sh
   git switch main
   git pull
   pnpm release:tag v0.1.0
   ```

   The script builds the tag text from the changelog section, creates a signed annotated tag and exits with an error unless `git tag -v` reports a good signature. It never pushes.
6. Publish the tag as the owner.

   ```sh
   OWNER_PROMOTION=1 git push origin v0.1.0
   ```

Images are built when a signed `v*` tag is pushed.

## Rehearse in a Temporary Clone

Never rehearse in the real repository. Use a clone and the dry-run switch.

```sh
tmp=$(mktemp -d)
git clone --no-local . "$tmp/repo"
cd "$tmp/repo"
git config gpg.format ssh
git config user.signingkey "<path to your public key>"
git config commit.gpgsign true
git config tag.gpgsign true
git config user.name "<your name>"
git config user.email "<your email>"
git config gpg.ssh.allowedSignersFile .github/allowed_signers
git switch active-dev
sh scripts/release-prepare.sh v0.1.0
git checkout -B main
RELEASE_DRY_RUN=1 sh scripts/release-tag.sh v0.1.0
git tag -v v0.1.0
```

You should see `Good "git" signature` in the last output. Delete the temporary folder afterwards.
