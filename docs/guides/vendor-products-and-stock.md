# Manage Vendor Products And Stock

This guide shows vendors how to create products and keep stock current. It also shows developers how to run the demo data and test the same flows in the vendor portal.

## Create A Draft

Open **Products** in the vendor portal and select **Create product**. A product starts as a draft that only you can see. The form has these limits.

- The title has at most 150 characters.
- The description has at most 5,000 characters. The portal keeps plain text and removes tags.
- You add 1 to 10 images. Each image can be up to 8 MB.
- You add up to 3 options and up to 50 variants.
- Each variant has a SKU of 1 to 40 letters, digits, dashes or underscores. A SKU is unique across all your products, and another vendor can use the same SKU.
- The price you enter is your payout price in rupees, from 0.01 to 999,999.99. The store sets the customer price when it approves the product.
- You also give a category, a GST class, an HSN code and the product declaration fields.

You do not choose handles, SKUs for customers or sales channels. The store assigns them at approval.

## Submit, Withdraw And Edit Live Products

Select **Submit for review** when the draft is saved. While the product is in review you cannot change it. The store team approves it, asks for changes or rejects it, and you receive an email.

Select **Withdraw** to take a product off review or off sale. A withdrawn product can be edited and submitted again.

When you edit a live product, the live version stays on sale until the store approves your change. The portal shows **Change waiting for review**. Select **Discard pending change** to drop it.

## Set Stock For Each Location

Open **Stock**. The table has one row for each variant of a live product and one column for each of your locations. Type a whole number from 0 to 1,000,000 and select **Save** on that row. The page marks a row with unsaved changes and sends only the cells you changed.

- Orders reserve units. You cannot set a quantity below the reserved number, and the page tells you the number.
- A **Low** badge appears when fewer than five units are available after the reserved units.
- You can set stock only for products that are live and only for your own locations.

## Update Stock From A CSV File

Select **Download template** to get a file with this first line.

```csv
vendor_sku,location_code,stocked_quantity
```

Add one row for each SKU and location. A worked example follows.

```csv
vendor_sku,location_code,stocked_quantity
KURTA-RED-S,LOC-0042,12
KURTA-RED-M,LOC-0042,9
KURTA-RED-S,LOC-0043,0
```

Select **Download current stock** to get every live variant at every location with today's quantities. Edit that file and upload it again if you prefer.

The file must be UTF-8 text, at most 1 MB and at most 5,000 data rows. Upload it with **Upload**. The result shows how many rows applied and how many failed. Rows that fail do not stop the other rows. You can upload the same file again safely, because every quantity is an absolute value.

| Code | What it means |
|---|---|
| `unknown_sku` | The SKU is not one of your products |
| `unknown_location` | The location code is not one of yours |
| `not_approved` | The product is not live yet |
| `invalid_quantity` | The quantity is not a whole number from 0 to 1,000,000 |
| `below_reserved` | The quantity is below the units reserved for orders |
| `duplicate_row` | The same SKU and location appeared earlier, and only the first row counts |

Some problems stop the whole file, and nothing changes. These are a wrong first line, more than 5,000 rows, a file over 1 MB, text that is not UTF-8 and a file that is not valid CSV. The result lists up to 200 row errors with the true totals.

## Run The Demo Data

Developers can create demo vendors, locations, products in every review state and stock with one command. It refuses to run in production and you can run it again safely.

```sh
pnpm -C apps/backend exec medusa exec ./src/migration-scripts/catalog-demo-seed.ts
```

The seed writes the sign-in details to the untracked `TEST-CREDENTIALS.local.md`. The sample CSV is `apps/backend/src/migration-scripts/data/test-data/stock-import.sample.csv`.

To reset the demo data, delete the products whose titles start with `Demo` in the Admin, or re-create the development database and run the seed commands again.

## Test The Flows

The browser specs cover the stock screen and the whole path from draft to live.

```sh
pnpm e2e -- vendor-portal-stock
pnpm e2e -- --project=chromium catalog-draft-to-live
```

## Related Pages

- [Catalog And Stock](../concepts/catalog-and-stock.md)
- [Review And Approve Products](review-and-approve-products.md)
