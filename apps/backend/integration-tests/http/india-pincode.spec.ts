import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createPublishableKey } from "../helpers/publishable-key";

jest.setTimeout(120 * 1000);

const KNOWN: [string, string][] = [
  ["400001", "IN-MH"],
  ["560001", "IN-KA"],
  ["110001", "IN-DL"],
  ["600001", "IN-TN"],
  ["700001", "IN-WB"],
  ["380001", "IN-GJ"],
];

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("store pincode lookup", () => {
      let headers: Record<string, string>;

      beforeAll(async () => {
        const token = await createPublishableKey(getContainer());
        headers = { "x-publishable-api-key": token };
      });

      const get = (pin: string, h: Record<string, string> = headers) =>
        api.get(`/store/india/pincodes/${pin}`, { headers: h }).catch((error: any) => error.response);

      it.each(KNOWN)("answers 200 with the state for %s", async (pin, state) => {
        const res = await get(pin);
        expect(res.status).toBe(200);
        expect(res.data.pin).toBe(pin);
        expect(res.data.state_code).toBe(state);
        expect(res.data.district).not.toBe("");
        expect(res.data.city).not.toBe("");
        expect(res.data.localities.length).toBeLessThanOrEqual(5);
        expect(Object.keys(res.data).sort()).toEqual([
          "city",
          "district",
          "localities",
          "pin",
          "state_code",
        ]);
      });

      it.each(["000001", "12345", "abcdef", "4000011"])("answers 400 for %s", async (pin) => {
        const res = await get(pin);
        expect(res.status).toBe(400);
      });

      // 999998 is absent from the bundled directory; 999999 is a real Telangana PIN.
      it("answers 404 for an unknown PIN", async () => {
        const res = await get("999998");
        expect(res.status).toBe(404);
      });

      it("sets the cache header on a hit", async () => {
        const res = await get("400001");
        expect(res.headers["cache-control"]).toBe("public, max-age=86400");
      });

      it("makes no outbound request", async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = (() => {
          throw new Error("outbound request attempted");
        }) as typeof fetch;
        try {
          const res = await get("560001");
          expect(res.status).toBe(200);
        } finally {
          globalThis.fetch = realFetch;
        }
      });

      it("rejects a request without the publishable key like every store route", async () => {
        const res = await get("400001", {});
        expect([400, 401]).toContain(res.status);
      });
    });
  },
});
