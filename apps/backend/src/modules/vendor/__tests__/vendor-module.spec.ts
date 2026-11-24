import { moduleIntegrationTestRunner } from "@medusajs/test-utils";
import { VENDOR_MODULE } from "..";
import LocationCodeSeq from "../models/location-code-seq";
import Vendor from "../models/vendor";
import VendorAgreementAcceptance from "../models/vendor-agreement-acceptance";
import VendorInvite from "../models/vendor-invite";
import VendorLocation from "../models/vendor-location";
import VendorUser from "../models/vendor-user";
import type VendorModuleService from "../service";

jest.setTimeout(120 * 1000);

const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000);
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

moduleIntegrationTestRunner<VendorModuleService>({
  moduleName: VENDOR_MODULE,
  moduleModels: [
    Vendor,
    VendorUser,
    VendorLocation,
    VendorInvite,
    VendorAgreementAcceptance,
    LocationCodeSeq,
  ],
  resolve: "./src/modules/vendor",
  testSuite: ({ service }) => {
    describe("vendor", () => {
      it("starts in status invited with empty activation and note fields", async () => {
        const vendor = await service.createVendors({
          internal_name: "Test Vendor One",
          contact_name: "Test Contact",
          contact_email: "contact@example.test",
        });
        expect(vendor.status).toBe("invited");
        expect(vendor.activated_at).toBeNull();
        expect(vendor.suspended_at).toBeNull();
        expect(vendor.suspend_reason).toBeNull();
        expect(vendor.note).toBeNull();
      });
    });

    describe("vendor user", () => {
      it("stores the email in lower case", async () => {
        const user = await service.createVendorUsers({
          vendor_id: "vnd_1",
          email: "Mixed.Case@Example.Test",
          name: "Mixed",
        });
        expect(user.email).toBe("mixed.case@example.test");
      });

      it("refuses a second user with the same email in any case", async () => {
        await service.createVendorUsers({ vendor_id: "vnd_1", email: "dup@example.test", name: "A" });
        await expect(
          service.createVendorUsers({ vendor_id: "vnd_2", email: "DUP@example.test", name: "B" })
        ).rejects.toThrow();
      });
    });

    describe("allocateLocationCode", () => {
      it("hands out 50 distinct codes under concurrency, LOC-0001 to LOC-0050", async () => {
        const codes = await Promise.all(
          Array.from({ length: 50 }, () => service.allocateLocationCode())
        );
        expect(new Set(codes).size).toBe(50);
        const expected = Array.from({ length: 50 }, (_, i) => `LOC-${String(i + 1).padStart(4, "0")}`);
        expect([...codes].sort()).toEqual(expected);
        await expect(service.allocateLocationCode()).resolves.toBe("LOC-0051");
      });
    });

    describe("invite tokens", () => {
      it("consumes a token once and returns null the second time", async () => {
        await service.createVendorInvites({
          vendor_user_id: "vusr_1",
          token_hash: "hash_once",
          expires_at: inOneHour(),
        });
        const first = await service.consumeInviteToken("hash_once");
        expect(first?.vendor_user_id).toBe("vusr_1");
        expect(typeof first?.id).toBe("string");
        await expect(service.consumeInviteToken("hash_once")).resolves.toBeNull();
      });

      it("lets exactly one of two simultaneous callers consume a token", async () => {
        await service.createVendorInvites({
          vendor_user_id: "vusr_2",
          token_hash: "hash_race",
          expires_at: inOneHour(),
        });
        const results = await Promise.all([
          service.consumeInviteToken("hash_race"),
          service.consumeInviteToken("hash_race"),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
      });

      it("does not consume an expired token", async () => {
        await service.createVendorInvites({
          vendor_user_id: "vusr_3",
          token_hash: "hash_expired",
          expires_at: anHourAgo(),
        });
        await expect(service.consumeInviteToken("hash_expired")).resolves.toBeNull();
      });

      it("returns null for an unknown hash", async () => {
        await expect(service.consumeInviteToken("hash_unknown")).resolves.toBeNull();
      });

      it("can consume a token again after it is released", async () => {
        const invite = await service.createVendorInvites({
          vendor_user_id: "vusr_4",
          token_hash: "hash_release",
          expires_at: inOneHour(),
        });
        await service.consumeInviteToken("hash_release");
        await service.releaseInviteToken(invite.id);
        const again = await service.consumeInviteToken("hash_release");
        expect(again?.id).toBe(invite.id);
      });
    });

    describe("location uniqueness", () => {
      it("refuses a second location with the same code", async () => {
        const base = {
          vendor_id: "vnd_1",
          label: "Main",
          state_code: "IN-MH",
          pin: "400001",
          address_1: "1 Test Street",
          pickup_contact_name: "Test",
          pickup_contact_phone: "0000000000",
        };
        await service.createVendorLocations({ ...base, code: "LOC-0001", stock_location_id: "sloc_1" });
        await expect(
          service.createVendorLocations({ ...base, code: "LOC-0001", stock_location_id: "sloc_2" })
        ).rejects.toThrow();
      });
    });
  },
});
