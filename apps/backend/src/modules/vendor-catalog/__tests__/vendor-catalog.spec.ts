import { moduleIntegrationTestRunner } from "@medusajs/test-utils";
import { VENDOR_CATALOG_MODULE } from "..";
import CatalogCounter from "../models/catalog-counter";
import ProductDeclaration from "../models/product-declaration";
import ProductSubmission from "../models/product-submission";
import VendorUpload from "../models/vendor-upload";
import VendorVariantRef from "../models/vendor-variant-ref";
import type VendorCatalogService from "../service";

jest.setTimeout(120 * 1000);

moduleIntegrationTestRunner<VendorCatalogService>({
  moduleName: VENDOR_CATALOG_MODULE,
  moduleModels: [
    ProductSubmission,
    VendorVariantRef,
    ProductDeclaration,
    VendorUpload,
    CatalogCounter,
  ],
  resolve: "./src/modules/vendor-catalog",
  testSuite: ({ service }) => {
    describe("product submission", () => {
      it("refuses a second submission for the same product and starts in draft", async () => {
        const first = await service.createProductSubmissions({
          product_id: "prod_sub_1",
          vendor_id: "vnd_1",
          content_hash: "hash-one",
        });
        expect(first.state).toBe("draft");
        expect(first.is_live).toBe(false);
        expect(first.revision).toBe(1);
        expect(first.hidden_by_suspension).toBe(false);

        await expect(
          service.createProductSubmissions({
            product_id: "prod_sub_1",
            vendor_id: "vnd_2",
            content_hash: "hash-two",
          })
        ).rejects.toThrow();
      });
    });

    describe("vendor variant ref", () => {
      const ref = (variant: string, vendor: string, sku: string) => ({
        variant_id: variant,
        product_id: `prod_${variant}`,
        vendor_id: vendor,
        vendor_sku: sku,
        payout_price: 100,
      });

      it("keeps a vendor SKU unique per vendor only and frees it after a soft delete", async () => {
        await service.createVendorVariantRefs(ref("variant_a1", "vnd_a", "SKU-1"));
        // Another vendor may use the same SKU text.
        await service.createVendorVariantRefs(ref("variant_b1", "vnd_b", "SKU-1"));
        // The same vendor may not, even with a different variant.
        await expect(
          service.createVendorVariantRefs(ref("variant_a2", "vnd_a", "SKU-1"))
        ).rejects.toThrow();

        const first = await service.listVendorVariantRefs({ variant_id: "variant_a1" });
        await service.softDeleteVendorVariantRefs(first[0].id);
        const reused = await service.createVendorVariantRefs(ref("variant_a3", "vnd_a", "SKU-1"));
        expect(reused.vendor_sku).toBe("SKU-1");
      });

      it("round-trips decimal rupees exactly", async () => {
        const created = await service.createVendorVariantRefs({
          ...ref("variant_money", "vnd_money", "SKU-MONEY"),
          payout_price: 199.99,
          mrp: 250,
        });
        const read = await service.retrieveVendorVariantRef(created.id);
        expect(Number(read.payout_price)).toBe(199.99);
        expect(Number(read.mrp)).toBe(250);
      });
    });

    describe("nextSkuNumber", () => {
      it("returns 50 distinct positive numbers under concurrency", async () => {
        const numbers = await Promise.all(
          Array.from({ length: 50 }, () => service.nextSkuNumber())
        );
        expect(new Set(numbers).size).toBe(50);
        expect(Math.min(...numbers)).toBeGreaterThan(0);
        expect(Math.max(...numbers) - Math.min(...numbers)).toBe(49);
      });
    });

    describe("product declaration", () => {
      it("is unique per product, stores the country code and accepts nulls", async () => {
        const created = await service.createProductDeclarations({
          product_id: "prod_decl_1",
          vendor_id: "vnd_1",
          country_of_origin: "IN",
        });
        expect(created.country_of_origin).toBe("IN");
        expect(created.generic_name).toBeNull();
        expect(created.packed_by_name).toBeNull();
        expect(created.packed_by_address).toBeNull();

        await expect(
          service.createProductDeclarations({
            product_id: "prod_decl_1",
            vendor_id: "vnd_2",
          })
        ).rejects.toThrow();
      });
    });
  },
});
