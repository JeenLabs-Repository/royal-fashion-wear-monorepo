# Set Up the India Region and GST

This guide explains what the India commerce seed creates, how to run it, and how to change a rate or a product class in Admin.

## What the Seed Creates

- One region named India with the INR currency and the country India. Its only payment provider is Razorpay. Every other region has no payment provider.
- A tax-inclusive price preference for that region, so the price you enter is the price the customer pays (the MRP).
- A tax region for India that uses the built-in tax provider, with a default rate of 18 percent named GST 18%.
- Four Product Types named GST-0, GST-5, GST-18 and GST-40, each with one rate (0, 5, 18 and 40 percent) that applies to products of that type.
- One rate of 18 percent for shipping, with a rule for each shipping option that ships in India.

The seed creates and updates only. It never deletes anything and it never changes the value of a rate that exists, so a rate you edited in Admin stays as you left it.

## Run the Seed

```sh
pnpm -C apps/backend seed:india
```

It is safe to repeat. A run that has nothing to do prints `[seed-india] nothing to change`. Run it again after you add a shipping option so the new option gets its tax rule. A fresh database seed runs it as its last step.

## Change a Rate or a Product Class

An accountant's answer is a data change, not a deploy.

1. To change a rate, open Settings, then Tax Regions, then India, and edit the rate.
2. To change the class of a product, open the product in Admin and pick another Product Type (GST-0, GST-5, GST-18 or GST-40).
3. To add a class, create a Product Type and add a rate for it under the India tax region with a rule on that product type.

The HSN code of a product lives in the HS code field of each variant.

## How Tax Appears in Prices

Prices are tax inclusive. A GST-5 item entered at 105.00 shows a cart total of 105.00 of which 5.00 is tax. The cart total always equals the entered price. Order data holds one tax line per item and per shipping method. It holds no separate CGST or SGST lines, because the split is worked out when an invoice is made, from the same totals.

## What the Accountant Must Confirm

The seeded rates, the class of each product category and the 18 percent tax on shipping are starting values for the accountant to review. They are not tax advice. Change them in Admin when the accountant answers.

## Open owner question: free orders

An order can only be placed when a Razorpay payment is captured. The seed removes the built-in system payment provider from the region, so a cart whose total is zero cannot be completed: a 100 percent discount, a free sample or any other zero-total cart has no way to pay.

The owner has decided: free orders are unsupported in this release. A test keeps that rule explicit, so a zero-total cart never turns into an order by accident.

If the owner ever wants free orders, a later release would add a way to complete a zero-total cart. That release must also prove that unpaid orders stay impossible for every cart with a total above zero. Nothing for it is built here. The decision is also listed in the owner review file and in the release checklist.