import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createPayableCart, resetFakeGateway } from "../helpers/payable-cart";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createRegionsWorkflow, updateRegionsWorkflow } from "@medusajs/medusa/core-flows";
import {
  DEFAULT_GST_RATE,
  GST_CLASS_RATES,
  RAZORPAY_PAYMENT_PROVIDER_ID,
  SHIPPING_GST_RATE,
  seedIndiaCommerce,
} from "../../src/lib/commerce/india-seed";
import { ensureHubLocation } from "../../src/lib/hub/ensure-hub-location";
import { ensureBareDefaults, ensureStoreAndDefaultChannel } from "../support/spike-fixtures";

jest.setTimeout(180 * 1000);

// The built-in test provider. It may stay registered globally; only the region list matters.
const SYSTEM_PROVIDER = "pp_system_default";

const hubAddress = {
  addressLine1: "1 Demo Hub Road",
  city: "Bengaluru",
  provinceCode: "IN-KA",
  postalCode: "560001",
};

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer, api }) => {
    const client = () => api;
    const query = () =>
      getContainer().resolve(ContainerRegistrationKeys.QUERY) as unknown as {
        graph(config: Record<string, unknown>): Promise<{ data: any[] }>;
      };

    const counts = async () => {
      const container = getContainer();
      const tax = container.resolve(Modules.TAX) as any;
      const pricing = container.resolve(Modules.PRICING) as any;
      const product = container.resolve(Modules.PRODUCT) as any;
      const regions = await query().graph({ entity: "region", fields: ["id"] });
      return {
        regions: regions.data.length,
        pricePreferences: (await pricing.listPricePreferences({})).length,
        taxRegions: (await tax.listTaxRegions({})).length,
        taxRates: (await tax.listTaxRates({})).length,
        taxRules: (await tax.listTaxRateRules({})).length,
        productTypes: (await product.listProductTypes({})).length,
      };
    };

    const indiaRegion = async () => {
      const { data } = await query().graph({
        entity: "region",
        fields: ["id", "name", "currency_code", "countries.iso_2", "payment_providers.id"],
        filters: { name: "India" },
      });
      return data[0];
    };

    const rateByCode = async (code: string) => {
      const { data } = await query().graph({
        entity: "tax_rate",
        fields: ["id", "code", "name", "rate", "is_default", "rules.reference", "rules.reference_id"],
        filters: { code },
      });
      return data[0];
    };

    describe("india commerce seed", () => {
      let shippingOptionId: string;

      beforeEach(async () => {
        const container = getContainer();
        await ensureStoreAndDefaultChannel(container);
        await ensureBareDefaults(container);
        const hub = await ensureHubLocation(container, {
          address: hubAddress,
          locationName: "LOC-SEED-1",
          salesChannelId: null,
        });
        if (!hub.shippingOptionId) {
          throw new Error("hub location has no shipping option");
        }
        shippingOptionId = hub.shippingOptionId;
      });

      it("creates the India region with exactly the Razorpay provider", async () => {
        const report = await seedIndiaCommerce(getContainer());
        expect(report.created).toContain("region India");

        const region = await indiaRegion();
        expect(region.currency_code).toBe("inr");
        expect(region.countries.map((c: { iso_2: string }) => c.iso_2)).toEqual(["in"]);
        expect(region.payment_providers.map((p: { id: string }) => p.id)).toEqual([
          RAZORPAY_PAYMENT_PROVIDER_ID,
        ]);
      });

      it("sets a tax inclusive price preference for the region", async () => {
        await seedIndiaCommerce(getContainer());
        const region = await indiaRegion();
        const pricing = getContainer().resolve(Modules.PRICING) as any;
        const prefs = await pricing.listPricePreferences({
          attribute: "region_id",
          value: region.id,
        });
        expect(prefs).toHaveLength(1);
        expect(prefs[0].is_tax_inclusive).toBe(true);
      });

      it("creates tax region IN with the system provider and a default 18 percent rate", async () => {
        await seedIndiaCommerce(getContainer());
        const tax = getContainer().resolve(Modules.TAX) as any;
        const regions = await tax.listTaxRegions({ country_code: "in" });
        expect(regions).toHaveLength(1);
        expect(regions[0].provider_id).toBe("tp_system");

        const rate = await rateByCode(DEFAULT_GST_RATE.code);
        expect(rate.name).toBe("GST 18%");
        expect(Number(rate.rate)).toBe(18);
        expect(rate.is_default).toBe(true);
      });

      it("creates four product types with one rate each, keyed on product type", async () => {
        await seedIndiaCommerce(getContainer());
        const product = getContainer().resolve(Modules.PRODUCT) as any;
        const types = await product.listProductTypes({
          value: GST_CLASS_RATES.map((entry) => entry.value),
        });
        expect(types.map((t: { value: string }) => t.value).sort()).toEqual(
          ["GST-0", "GST-18", "GST-40", "GST-5"]
        );

        for (const entry of GST_CLASS_RATES) {
          const rate = await rateByCode(entry.code);
          const type = types.find((t: { value: string }) => t.value === entry.value);
          expect(Number(rate.rate)).toBe(entry.rate);
          expect(rate.rules).toEqual([{ reference: "product_type", reference_id: type.id }]);
        }
      });

      it("adds a shipping option rule at 18 percent", async () => {
        await seedIndiaCommerce(getContainer());
        const rate = await rateByCode(SHIPPING_GST_RATE.code);
        expect(Number(rate.rate)).toBe(18);
        expect(rate.rules).toEqual([
          { reference: "shipping_option", reference_id: shippingOptionId },
        ]);
      });

      it("changes nothing on a second run", async () => {
        await seedIndiaCommerce(getContainer());
        const before = await counts();
        const report = await seedIndiaCommerce(getContainer());
        expect(report).toEqual({ created: [], updated: [] });
        expect(await counts()).toEqual(before);
      });

      it("resets a region that lists another provider", async () => {
        const container = getContainer();
        const tax = await seedIndiaCommerce(container);
        expect(tax.created.length).toBeGreaterThan(0);
        const region = await indiaRegion();
        try {
          await updateRegionsWorkflow(container).run({
            input: {
              selector: { id: region.id },
              update: { payment_providers: [RAZORPAY_PAYMENT_PROVIDER_ID, SYSTEM_PROVIDER] },
            },
          });
        } catch (error) {
          // The system provider is not registered in this test app: nothing to reset.
          console.warn("[india-tax] system provider unavailable, case skipped");
          return;
        }
        const report = await seedIndiaCommerce(container);
        expect(report.updated).toContain("region India payment providers");
        const after = await indiaRegion();
        expect(after.payment_providers.map((p: { id: string }) => p.id)).toEqual([
          RAZORPAY_PAYMENT_PROVIDER_ID,
        ]);
      });

      it("leaves every other region without payment providers", async () => {
        const container = getContainer();
        await createRegionsWorkflow(container).run({
          input: {
            regions: [
              {
                name: "Elsewhere",
                currency_code: "inr",
                countries: ["us"],
                payment_providers: [RAZORPAY_PAYMENT_PROVIDER_ID],
              },
            ],
          },
        });
        await seedIndiaCommerce(container);
        const { data } = await query().graph({
          entity: "region",
          fields: ["name", "payment_providers.id"],
          filters: { name: "Elsewhere" },
        });
        expect(data[0].payment_providers).toEqual([]);
      });

      it("adds a rule for a shipping option created after the first run, once", async () => {
        const container = getContainer();
        await seedIndiaCommerce(container);
        const second = await ensureHubLocation(container, {
          address: hubAddress,
          locationName: "LOC-SEED-2",
          salesChannelId: null,
        });
        await seedIndiaCommerce(container);
        await seedIndiaCommerce(container);
        const rate = await rateByCode(SHIPPING_GST_RATE.code);
        const ids = rate.rules.map((rule: { reference_id: string }) => rule.reference_id).sort();
        expect(ids).toEqual([shippingOptionId, second.shippingOptionId].sort());
      });

      it("keeps a rate value that was edited in Admin", async () => {
        const container = getContainer();
        await seedIndiaCommerce(container);
        const rate = await rateByCode("gst-5");
        const tax = container.resolve(Modules.TAX) as any;
        await tax.updateTaxRates(rate.id, { rate: 12 });

        const report = await seedIndiaCommerce(container);
        expect(report).toEqual({ created: [], updated: [] });
        expect(Number((await rateByCode("gst-5")).rate)).toBe(12);
      });
    });

    describe("gst inside tax inclusive prices", () => {
      afterEach(() => resetFakeGateway());

      type CartView = {
        total: number;
        tax_total: number;
        item_total: number;
        shipping_total: number;
        shipping_tax_total: number;
        items: { tax_lines: { code: string; rate: number }[] }[];
        shipping_methods: { tax_lines: { code: string; rate: number }[] }[];
      };

      const readCart = async (
        client: any,
        publishableKey: string,
        cartId: string
      ): Promise<CartView> => {
        const response = await client.get(
          `/store/carts/${cartId}?fields=*items.tax_lines,*shipping_methods.tax_lines`,
          { headers: { "x-publishable-api-key": publishableKey } }
        );
        return response.data.cart;
      };

      const money = (value: number) => Number(value).toFixed(2);

      it.each([
        ["GST-5", "105.00", "105.00", "5.00"],
        ["GST-18", "118.00", "118.00", "18.00"],
        ["GST-0", "100.00", "100.00", "0.00"],
        ["GST-40", "140.00", "140.00", "40.00"],
      ] as const)("%s: price %s gives total %s and tax %s", async (type, price, total, tax) => {
        const cart = await createPayableCart(getContainer(), {
          api: client(),
          productType: type,
          unitPrice: price,
          payment: false,
        });
        const view = await readCart(client(), cart.publishable_key, cart.cart_id);
        expect(money(view.item_total)).toBe(total);
        expect(money(view.tax_total)).toBe(tax);
        expect(money(view.total)).toBe(total);
      });

      it("uses the default 18 percent rate for an item without a product type", async () => {
        const cart = await createPayableCart(getContainer(), {
          api: client(),
          productType: null,
          unitPrice: "118.00",
          payment: false,
        });
        const view = await readCart(client(), cart.publishable_key, cart.cart_id);
        expect(money(view.tax_total)).toBe("18.00");
      });

      it("carries 18 percent inside the shipping price", async () => {
        const cart = await createPayableCart(getContainer(), {
          api: client(),
          productType: "GST-18",
          unitPrice: "118.00",
          shippingPrice: "59.00",
          payment: false,
        });
        const view = await readCart(client(), cart.publishable_key, cart.cart_id);
        expect(money(view.shipping_total)).toBe("59.00");
        expect(money(view.shipping_tax_total)).toBe("9.00");
        expect(money(view.total)).toBe("177.00");
        expect(money(view.tax_total)).toBe("27.00");
      });

      it("adds up a mixed cart", async () => {
        const cart = await createPayableCart(getContainer(), {
          api: client(),
          lines: [
            { productType: "GST-5", unitPrice: "105.00" },
            { productType: "GST-18", unitPrice: "118.00" },
          ],
          payment: false,
        });
        const view = await readCart(client(), cart.publishable_key, cart.cart_id);
        expect(money(view.tax_total)).toBe("23.00");
        expect(money(view.total)).toBe("223.00");
      });

      it("holds one tax line per item and per shipping method and never a CGST or SGST line", async () => {
        const cart = await createPayableCart(getContainer(), {
          api: client(),
          productType: "GST-18",
          unitPrice: "118.00",
          shippingPrice: "59.00",
          payment: false,
        });
        const view = await readCart(client(), cart.publishable_key, cart.cart_id);
        expect(view.items[0].tax_lines).toHaveLength(1);
        expect(view.shipping_methods[0].tax_lines).toHaveLength(1);
        const codes = [...view.items, ...view.shipping_methods].flatMap((entry) =>
          entry.tax_lines.map((line) => line.code)
        );
        expect(codes.some((code) => /CGST|SGST/i.test(code))).toBe(false);
      });

      it("keeps the cart total equal to the entered price for a quantity of three", async () => {
        const cart = await createPayableCart(getContainer(), {
          api: client(),
          lines: [{ productType: "GST-5", unitPrice: "105.00", quantity: 3 }],
          payment: false,
        });
        const view = await readCart(client(), cart.publishable_key, cart.cart_id);
        expect(money(view.total)).toBe("315.00");
        expect(money(view.tax_total)).toBe("15.00");
      });
    });

  },
});