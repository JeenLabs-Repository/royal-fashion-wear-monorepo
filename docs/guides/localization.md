# Languages

The storefront, the transactional emails and the seed data support the languages listed in one place: the `locales` array in `apps/storefront/src/i18n/config.ts`. Today that list holds English only. The plumbing for more languages is kept, so adding one is a catalog and configuration change.

## Add a Language

Replace `<code>` with the language code, for example `hi`.

1. Add the code to `locales` and a native-name label to `localeLabels` in `apps/storefront/src/i18n/config.ts`.
2. Add `apps/storefront/messages/<code>.json` with every key of `en.json` translated. Add the language to `LanguageSelect.locales` in every storefront catalog, not only the new one.
3. Add `apps/backend/src/emails/i18n/messages/<code>.json`. In `apps/backend/src/emails/i18n/messages.ts` add its import and an entry in `emailMessages`. If the language is also written with another code, add that code to `LOCALE_ALIASES` in `apps/backend/src/emails/i18n/locale.ts`.
4. Add `apps/backend/src/migration-scripts/data/i18n/json/<code>.json`. The seed script finds it by file name.
5. Enable the locale for the store in the Admin settings. The menu name can differ between Medusa releases, so look for the store's supported locales in the installed version.
6. Run the parity check and fix whatever it reports:

   ```sh
   node scripts/check-catalog-parity.mjs
   ```

7. Run the storefront and backend builds and the browser specs.

A right-to-left language also needs the direction support that was removed: the document direction attribute, a direction hook and the `rtl:` style variants. See `docs/decisions/0005-english-only-with-locale-plumbing-kept.md` for what was removed and why.

The catalogs of the other languages that the starter shipped, Hindi included, are deleted from this repository. The untouched copy of the starter that the owner keeps outside the repository still holds them, and they can serve as a starting point for a translation.

## What Stays Fixed

- The locale is stored in a cookie, and the storefront uses `localePrefix` set to `never` in `apps/storefront/src/i18n/routing.ts`.
- The `locales` array is the single source of truth. The sitemap, the language alternates in the page head, `llms.txt` and product search read it; they need no edit when a language is added.
- Every catalog set holds one file per language, with the same keys as the English file. The parity check enforces it in CI.
