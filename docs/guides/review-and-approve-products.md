# Review And Approve Products

This guide shows staff how to review a vendor's product and decide. The product reaches customers only after you approve it, so the review is the store's last check that nothing identifies the vendor.

## Before You Start

You need one of these permissions on your staff role.

- `catalog:read` to open the queue and read a product.
- `catalog:edit` to change the title, the description or the image order.
- `catalog:review` to approve, reject or request changes.

If your role lacks a permission, the buttons for it stay disabled and the API refuses the request.

## Open The Queue

1. Sign in to the Admin and open **Product reviews**.
2. Choose a tab. **New** holds first submissions. **Live edits** holds changes to live products. **Changes requested** and **Rejected** show earlier decisions.
3. Open the oldest item first. The queue lists the oldest submission at the top.

## Read The Product

The detail page shows the vendor's content beside the live version when the product is live. A field-level diff marks what changed. You also see the payout price beside the price you will set, the declarations and the images.

Look for these problems in the images before you approve.

- A logo, a watermark or a brand name that points to the vendor.
- A shop name, a phone number, a website or a social handle in the picture.
- A price tag, a packing slip or a label that carries an address.
- A photo of the vendor's premises or staff.

Look for the same kinds of text in the title and the description.

## Edit What You Can Fix

If the title, the description or the image order needs a small fix, edit it on the page and save. Your edit is recorded as before and after. After an edit the checklist clears, and you tick it again.

## Set Prices And Classification

1. Enter the selling price for every variant. The price cannot be higher than the MRP the vendor entered, and the page names the SKU that breaks the rule.
2. Choose the GST class.
3. Check the HSN code. It has 4, 6 or 8 digits.
4. Choose the category.

## Tick The Six Checks And Decide

Approve stays disabled until you tick all six checks and every variant has a valid price, a GST class, an HSN code and a category. The server checks the same rules, so the page is a convenience only.

- **Approve** puts the product on sale. The platform assigns the SKUs and the handle.
- **Request changes** sends the product back to the vendor for edits. Write a reason of at least 10 characters. The vendor sees it.
- **Reject** declines the product. Write a reason of at least 10 characters. The vendor sees it.

When you reject a live edit, the live product keeps selling.

## Handle A Stale Page

If the page says the item changed after you opened it, someone saved a new version while you worked. Select **Reload**, read the new version, and tick the checks again. The API answers 409 with the code `stale_revision` in this case.

## Related Pages

- [Catalog And Stock](../concepts/catalog-and-stock.md)
- [Manage Vendor Products And Stock](vendor-products-and-stock.md)
