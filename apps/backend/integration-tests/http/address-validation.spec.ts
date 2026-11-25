import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createStoresWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";

jest.setTimeout(120 * 1000);

const GOOD = {
  first_name: "Asha",
  last_name: "Rao",
  address_1: "12 Main Road",
  city: "Mumbai",
  country_code: "in",
};

const attempt = async (call: Promise<any>) => {
  try {
    return await call;
  } catch (error: any) {
    if (error.response) {
      return error.response;
    }
    throw error;
  }
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let storeHeaders: Record<string, string>;
    let regionId: string;
    let channelId: string;
    let customerHeaders: Record<string, string>;

    const newCart = async () => {
      const res = await api.post(
        "/store/carts",
        { region_id: regionId, sales_channel_id: channelId },
        { headers: storeHeaders }
      );
      return res.data.cart.id as string;
    };

    const readCart = async (id: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({
        entity: "cart",
        fields: ["id", "shipping_address.*", "billing_address.*"],
        filters: { id },
      });
      return data[0];
    };

    const updateCart = (id: string, body: Record<string, unknown>) =>
      attempt(api.post(`/store/carts/${id}`, body, { headers: storeHeaders }));

    const readCustomerAddresses = async () => {
      const res = await api.get("/store/customers/me?fields=*addresses", {
        headers: customerHeaders,
      });
      return res.data.customer.addresses as Record<string, any>[];
    };

    beforeEach(async () => {
      const container = getContainer();

      const query: any = container.resolve(ContainerRegistrationKeys.QUERY);
      let { data: stores } = await query.graph({
        entity: "store",
        fields: ["id", "default_sales_channel_id", "supported_currencies.currency_code"],
      });
      if (!stores[0]) {
        await createStoresWorkflow(container).run({
          input: {
            stores: [
              {
                name: "Address Test Store",
                supported_currencies: [{ currency_code: "inr", is_default: true }],
              },
            ],
          },
        });
        ({ data: stores } = await query.graph({
          entity: "store",
          fields: ["id", "default_sales_channel_id", "supported_currencies.currency_code"],
        }));
      }

      const {
        result: [region],
      } = await createRegionsWorkflow(container).run({
        input: {
          regions: [{ name: "India", currency_code: "inr", countries: ["in"] }],
        },
      });
      regionId = region.id;

      const {
        result: [channel],
      } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: "Address Test Channel" }] },
      });
      channelId = channel.id;

      if (!stores[0]?.default_sales_channel_id) {
        await updateStoresWorkflow(container).run({
          input: {
            selector: { id: stores[0].id },
            update: { default_sales_channel_id: channelId },
          },
        });
      }

      const {
        result: [key],
      } = await createApiKeysWorkflow(container).run({
        input: {
          api_keys: [
            { title: "address-test", type: "publishable", created_by: "" },
          ],
        },
      });
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: key.id, add: [channel.id] },
      });
      storeHeaders = { "x-publishable-api-key": key.token };

      const email = `buyer-${Date.now()}@example.test`;
      const password = ["Buyer", "test", "pwd", "99"].join("-");
      const registered = await api.post("/auth/customer/emailpass/register", {
        email,
        password,
      });
      await api.post(
        "/store/customers",
        { email },
        {
          headers: {
            ...storeHeaders,
            authorization: `Bearer ${registered.data.token}`,
          },
        }
      );
      const login = await api.post("/auth/customer/emailpass", {
        email,
        password,
      });
      customerHeaders = {
        ...storeHeaders,
        authorization: `Bearer ${login.data.token}`,
      };
    });

    describe("cart addresses", () => {
      it("rejects a known PIN with the wrong state and leaves the cart unchanged", async () => {
        const id = await newCart();
        const res = await updateCart(id, {
          shipping_address: {
            ...GOOD,
            postal_code: "400001",
            province: "in-ka",
            phone: "9876543210",
          },
        });
        expect(res.status).toBe(400);
        expect(res.data.code).toBe("pin_state_mismatch");
        const cart = await readCart(id);
        // Core may keep an empty address shell on a new cart; the rejected
        // write must not land the posted fields.
        expect(cart.shipping_address?.postal_code).toBeFalsy();
        expect(cart.shipping_address?.province).toBeFalsy();
        expect(cart.shipping_address?.address_1).toBeFalsy();
      });

      it("accepts the right state and stores no unverified flag", async () => {
        const id = await newCart();
        const res = await updateCart(id, {
          shipping_address: {
            ...GOOD,
            postal_code: "400001",
            province: "IN-MH",
            phone: "9876543210",
          },
        });
        expect(res.status).toBe(200);
        const cart = await readCart(id);
        expect(cart.shipping_address.province).toBe("in-mh");
        expect(cart.shipping_address.metadata?.pin_unverified).toBeUndefined();
      });

      // 999998 is absent from the bundled directory; 999999 is a real Telangana PIN.
      it("accepts an unknown PIN and flags the stored address", async () => {
        const id = await newCart();
        const res = await updateCart(id, {
          shipping_address: {
            ...GOOD,
            postal_code: "999998",
            province: "in-mh",
            phone: "9876543210",
          },
        });
        expect(res.status).toBe(200);
        const cart = await readCart(id);
        expect(cart.shipping_address.metadata.pin_unverified).toBe(true);
      });

      it("validates the billing address the same way", async () => {
        const id = await newCart();
        const res = await updateCart(id, {
          billing_address: {
            ...GOOD,
            postal_code: "400001",
            province: "in-ka",
          },
        });
        expect(res.status).toBe(400);
        expect(res.data.code).toBe("pin_state_mismatch");
      });

      it("rejects a malformed PIN", async () => {
        const id = await newCart();
        const res = await updateCart(id, {
          shipping_address: { ...GOOD, postal_code: "40001", province: "in-mh" },
        });
        expect(res.status).toBe(400);
        expect(res.data.code).toBe("invalid_pin_format");
      });

      it("rejects an unrecognised province", async () => {
        const id = await newCart();
        const res = await updateCart(id, {
          shipping_address: {
            ...GOOD,
            postal_code: "400001",
            province: "Maharashtra",
          },
        });
        expect(res.status).toBe(400);
        expect(res.data.code).toBe("invalid_province");
      });

      it("rejects a phone that is not a mobile number", async () => {
        const id = await newCart();
        const res = await updateCart(id, {
          shipping_address: { ...GOOD, phone: "1234567890" },
        });
        expect(res.status).toBe(400);
        expect(res.data.code).toBe("invalid_phone");
      });

      it("stores a +91 phone in its ten-digit form", async () => {
        const id = await newCart();
        const res = await updateCart(id, {
          shipping_address: { ...GOOD, phone: "+91 98765 43210" },
        });
        expect(res.status).toBe(200);
        const cart = await readCart(id);
        expect(cart.shipping_address.phone).toBe("9876543210");
      });

      it("leaves a body with no address keys alone", async () => {
        const id = await newCart();
        const res = await updateCart(id, { email: "buyer@example.test" });
        expect(res.status).toBe(200);
      });

      it("clears a stale flag when the PIN becomes verified", async () => {
        const id = await newCart();
        await updateCart(id, {
          shipping_address: { ...GOOD, postal_code: "999998", province: "in-mh" },
        });
        const flagged = await readCart(id);
        expect(flagged.shipping_address.metadata.pin_unverified).toBe(true);
        const res = await updateCart(id, {
          shipping_address: {
            ...GOOD,
            postal_code: "400001",
            province: "in-mh",
            metadata: flagged.shipping_address.metadata,
          },
        });
        expect(res.status).toBe(200);
        const cleared = await readCart(id);
        expect(cleared.shipping_address.metadata?.pin_unverified).toBeUndefined();
      });
    });

    describe("customer addresses", () => {
      const create = (body: Record<string, unknown>) =>
        attempt(
          api.post("/store/customers/me/addresses", body, {
            headers: customerHeaders,
          })
        );

      it("rejects a wrong pair on create", async () => {
        const res = await create({
          ...GOOD,
          postal_code: "400001",
          province: "in-ka",
        });
        expect(res.status).toBe(400);
        expect(res.data.code).toBe("pin_state_mismatch");
        expect(await readCustomerAddresses()).toHaveLength(0);
      });

      it("stores a verified address with a lower-case province", async () => {
        const res = await create({
          ...GOOD,
          postal_code: "400001",
          province: "IN-MH",
          phone: "+919876543210",
        });
        expect(res.status).toBe(200);
        const [saved] = await readCustomerAddresses();
        expect(saved.province).toBe("in-mh");
        expect(saved.phone).toBe("9876543210");
      });

      it("flags an unknown PIN on create", async () => {
        const res = await create({
          ...GOOD,
          postal_code: "999998",
          province: "in-mh",
        });
        expect(res.status).toBe(200);
        const [saved] = await readCustomerAddresses();
        expect(saved.metadata.pin_unverified).toBe(true);
      });

      it("rejects a wrong pair on update", async () => {
        await create({ ...GOOD, postal_code: "400001", province: "in-mh" });
        const [saved] = await readCustomerAddresses();
        const res = await attempt(
          api.post(
            `/store/customers/me/addresses/${saved.id}`,
            { postal_code: "400001", province: "in-ka" },
            { headers: customerHeaders }
          )
        );
        expect(res.status).toBe(400);
        expect(res.data.code).toBe("pin_state_mismatch");
      });

      it("rejects a bad phone on update", async () => {
        await create({ ...GOOD, postal_code: "400001", province: "in-mh" });
        const [saved] = await readCustomerAddresses();
        const res = await attempt(
          api.post(
            `/store/customers/me/addresses/${saved.id}`,
            { phone: "12345" },
            { headers: customerHeaders }
          )
        );
        expect(res.status).toBe(400);
        expect(res.data.code).toBe("invalid_phone");
      });

      it("answers 401 without a customer token, before any address rule", async () => {
        const res = await attempt(
          api.post(
            "/store/customers/me/addresses",
            { ...GOOD, postal_code: "400001", province: "in-ka" },
            { headers: storeHeaders }
          )
        );
        expect(res.status).toBe(401);
      });
    });

    describe("other routes", () => {
      it("still lists products", async () => {
        const res = await api.get("/store/products", { headers: storeHeaders });
        expect(res.status).toBe(200);
      });
    });
  },
});
