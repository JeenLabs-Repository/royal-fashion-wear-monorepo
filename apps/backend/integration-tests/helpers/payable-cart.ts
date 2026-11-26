import crypto from "crypto";
import type { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  MedusaError,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows";
// <RESOLVE: the real package scope and the public export. Commands:
// node -p "require('./config/plugin-registry.json').scope"
// grep -n "setRazorpayClientFactoryForTests" <plugin repo>/src/public.ts>
import { setRazorpayClientFactoryForTests } from "@jeenlabs-repository/medusa-payment-razorpay/public";
import { ensureGstProductTypes } from "../../src/lib/catalog/ensure-gst-types";
import type { GstProductTypeValue } from "../../src/lib/catalog/ensure-gst-types";
import { RAZORPAY_PAYMENT_PROVIDER_ID, seedIndiaCommerce } from "../../src/lib/commerce/india-seed";
import { ensureHubLocation } from "../../src/lib/hub/ensure-hub-location";
import { ensureBareDefaults, ensureStoreAndDefaultChannel } from "../support/spike-fixtures";

type ApiClient = {
  get(url: string, config?: Record<string, unknown>): Promise<{ data: any }>;
  post(url: string, body?: unknown, config?: Record<string, unknown>): Promise<{ data: any }>;
};

type Query = {
  graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
};

/** Decimal rupees as text to integer paise as text. Pure string work, no float arithmetic. */
export function paiseOf(rupees: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(rupees);
  if (!match) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `[payable-cart] not a rupee amount: ${rupees}`);
  }
  const whole = match[1];
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
}

export type ScriptedPayment = {
  status: "captured" | "authorized" | "failed" | "created";
  amount_rupees: string;
};

export type FakeGateway = {
  /** Gateway order ids handed out so far. */
  orders: string[];
  /** What the gateway reports for any order. Change it between steps of a test. */
  payments: ScriptedPayment[];
  /** True makes every payment lookup throw, like an outage. */
  failLookups: boolean;
  /** Names of the gateway calls made, in order. */
  calls: string[];
};

export function createFakeGateway(): FakeGateway {
  return { orders: [], payments: [], failLookups: false, calls: [] };
}

let gatewayOrderCounter = 0;

/**
 * Installs a stand-in for the Razorpay client. The shape follows the SDK calls the
 * provider makes.
 * Order creation and the payment lookups of authorization go through this client. Refunds and
 * the reconciliation payment list use the plain HTTP helper, which the refund and
 * reconciliation specs script with a scoped fetch replacement instead.
 * <RESOLVE: confirm which calls use the SDK client and which use the HTTP helper. Command:
 * grep -n "orders\.\|payments\.\|razorpayRequest" <plugin repo>/src/providers/razorpay/service.ts>
 */
export function installFakeGateway(gateway: FakeGateway): void {
  const toEntity = (payment: ScriptedPayment, index: number, orderId: string) => ({
    id: `pay_test_${index + 1}`,
    entity: "payment",
    order_id: orderId,
    amount: Number(paiseOf(payment.amount_rupees)),
    currency: "INR",
    status: payment.status,
    captured: payment.status === "captured",
  });
  const client = {
    orders: {
      create: async (body: {
        amount: number;
        currency: string;
        receipt: string;
        notes?: Record<string, string>;
      }) => {
        gateway.calls.push("orders.create");
        gatewayOrderCounter += 1;
        const id = `order_test_${gatewayOrderCounter}`;
        gateway.orders.push(id);
        return {
          id,
          entity: "order",
          amount: body.amount,
          currency: body.currency,
          receipt: body.receipt,
          status: "created",
          notes: body.notes ?? {},
        };
      },
      fetchPayments: async (orderId: string) => {
        gateway.calls.push("orders.fetchPayments");
        if (gateway.failLookups) {
          throw new Error("gateway unavailable");
        }
        const items = gateway.payments.map((payment, index) => toEntity(payment, index, orderId));
        return { entity: "collection", count: items.length, items };
      },
    },
    payments: {
      fetch: async (paymentId: string) => {
        gateway.calls.push("payments.fetch");
        if (gateway.failLookups) {
          throw new Error("gateway unavailable");
        }
        const index = Number(paymentId.replace("pay_test_", "")) - 1;
        const payment = gateway.payments[index];
        if (!payment) {
          throw new Error("payment not found");
        }
        return toEntity(payment, index, gateway.orders[gateway.orders.length - 1] ?? "");
      },
    },
  };
  setRazorpayClientFactoryForTests((() => client) as never);
}

export function resetFakeGateway(): void {
  setRazorpayClientFactoryForTests(null);
}

export type RazorpayCardSecrets = {
  key_id: string;
  key_secret: string;
  webhook_secret: string;
};

/**
 * Saves the integration-razorpay card with a fake test key and random secrets and
 * returns them. Needs a superadmin's headers.
 * <RESOLVE: the card routes of the settings plugin. Command:
 * find apps/backend/node_modules/@gorgo/medusa-integration -path "*api/admin/integrations*" -name "route.*" | head>
 */
export async function ensureRazorpayCard(
  api: ApiClient,
  adminHeaders: Record<string, string>
): Promise<RazorpayCardSecrets> {
  const secrets: RazorpayCardSecrets = {
    key_id: `rzp_test_${crypto.randomBytes(7).toString("hex")}`,
    key_secret: crypto.randomBytes(16).toString("hex"),
    webhook_secret: crypto.randomBytes(16).toString("hex"),
  };
  const list = await api.get("/admin/integrations", { headers: adminHeaders });
  const card = (list.data.integrations ?? []).find(
    (item: { identifier?: string; id?: string; provider_id?: string }) =>
      item.identifier === "integration-razorpay" || item.id === "integration-razorpay"
  );
  if (!card) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "[payable-cart] the integration-razorpay card is not registered"
    );
  }
  const providerId = String(card.provider_id ?? card.id);
  await api.post(
    `/admin/integrations/${providerId}`,
    { values: { ...secrets, merchant_display_name: "Demo Store" } },
    { headers: adminHeaders }
  );
  return secrets;
}

/**
 * Deletes the saved Razorpay card values so the next webhook sees no secret and
 * answers 503. The provider registration stays; call ensureRazorpayCard again to restore.
 */
export async function clearRazorpayCard(
  api: ApiClient,
  adminHeaders: Record<string, string>
): Promise<void> {
  const list = await api.get("/admin/integrations", { headers: adminHeaders });
  const card = (list.data.integrations ?? []).find(
    (item: { identifier?: string; id?: string; provider_id?: string }) =>
      item.identifier === "integration-razorpay" || item.id === "integration-razorpay"
  );
  if (!card) {
    return;
  }
  const providerId = String(card.provider_id ?? card.id);
  await api.delete(`/admin/integrations/${providerId}`, {
    headers: adminHeaders,
    validateStatus: () => true,
  });
}

export type PayableLine = {
  /** null leaves the product without a type, so the default rate applies. */
  productType: GstProductTypeValue | null;
  /** Decimal rupees as text, tax included. */
  unitPrice: string;
  quantity?: number;
};

export type PayableCartOptions = {
  api: ApiClient;
  /** Superadmin headers. Required unless payment is false. */
  adminHeaders?: Record<string, string>;
  lines?: PayableLine[];
  productType?: GstProductTypeValue | null;
  unitPrice?: string;
  /** Decimal rupees as text. Defaults to 0.00. */
  shippingPrice?: string;
  /** False stops before the payment collection. Default true. */
  payment?: boolean;
  /** Defaults to a fresh gateway that is also installed. */
  gateway?: FakeGateway;
};

export type PayableCart = {
  cart_id: string;
  region_id: string;
  payment_collection_id: string | null;
  session_id: string | null;
  razorpay_order_id: string | null;
  publishable_key: string;
  shipping_option_id: string;
  stock_location_id: string;
  inventory_item_ids: string[];
  variant_ids: string[];
  gateway: FakeGateway;
  card: RazorpayCardSecrets | null;
};

const queryOf = (container: MedusaContainer): Query =>
  container.resolve(ContainerRegistrationKeys.QUERY) as unknown as Query;

let cartCounter = 0;

export async function createPayableCart(
  container: MedusaContainer,
  options: PayableCartOptions
): Promise<PayableCart> {
  if (process.env.NODE_ENV === "production") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "[payable-cart] never runs in production");
  }
  cartCounter += 1;
  const stamp = `${cartCounter}-${Date.now()}`;
  const api = options.api;
  const withPayment = options.payment ?? true;
  const lines: PayableLine[] = options.lines ?? [
    {
      productType: options.productType === undefined ? "GST-18" : options.productType,
      unitPrice: options.unitPrice ?? "118.00",
    },
  ];
  const gateway = options.gateway ?? createFakeGateway();
  installFakeGateway(gateway);

  const { channelId: defaultChannelId } = await ensureStoreAndDefaultChannel(container);
  void defaultChannelId;
  await ensureBareDefaults(container);

  const { result: channels } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: `Payable Channel ${stamp}` }] },
  });
  const channelId = (channels as { id: string }[])[0].id;

  const { result: keys } = await createApiKeysWorkflow(container).run({
    input: { api_keys: [{ title: `payable-${stamp}`, type: "publishable", created_by: "" }] },
  });
  const key = (keys as { id: string; token: string }[])[0];
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: key.id, add: [channelId] },
  });

  // The hub helper creates the stock location, fulfilment set, service zone and the
  // "Standard Delivery" option, so the shipping rule exists before the seed runs.
  const hub = await ensureHubLocation(container, {
    address: {
      addressLine1: "1 Demo Hub Road",
      city: "Bengaluru",
      provinceCode: "IN-KA",
      postalCode: "560001",
    },
    shippingPriceInr: Number(options.shippingPrice ?? "0.00"),
    locationName: `LOC-PC-${stamp}`,
    salesChannelId: channelId,
  });

  await seedIndiaCommerce(container);
  const { data: regions } = await queryOf(container).graph({
    entity: "region",
    fields: ["id"],
    filters: { name: "India" },
  });
  const regionId = String(regions[0].id);

  const typeIds = await ensureGstProductTypes(container);
  const { data: profiles } = await queryOf(container).graph({
    entity: "shipping_profile",
    fields: ["id"],
  });
  const profileId = String(profiles[0].id);

  const variantIds: string[] = [];
  const inventoryItemIds: string[] = [];
  for (const [index, line] of lines.entries()) {
    const { result: products } = await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: `Payable Product ${stamp}-${index}`,
            handle: `payable-product-${stamp}-${index}`,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: profileId,
            ...(line.productType ? { type_id: typeIds[line.productType] } : {}),
            options: [{ title: "Size", values: ["M"] }],
            variants: [
              {
                title: "M",
                sku: `PAYABLE-${stamp}-${index}`,
                options: { Size: "M" },
                manage_inventory: true,
                // <RESOLVE: confirm a decimal string is accepted as an amount. Command:
                // grep -n "BigNumberInput" apps/backend/node_modules/@medusajs/types/dist/pricing/common/money-amount.d.ts>
                prices: [{ amount: line.unitPrice as never, currency_code: "inr" }],
              },
            ],
            sales_channels: [{ id: channelId }],
          },
        ],
      },
    });
    const product = (products as { variants: { id: string }[] }[])[0];
    const variantId = product.variants[0].id;
    variantIds.push(variantId);

    const { data: variants } = await queryOf(container).graph({
      entity: "product_variant",
      fields: ["id", "inventory_items.inventory_item_id"],
      filters: { id: variantId },
    });
    const inventoryItemId = String(variants[0]?.inventory_items?.[0]?.inventory_item_id ?? "");
    if (!inventoryItemId) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "[payable-cart] variant has no inventory item");
    }
    inventoryItemIds.push(inventoryItemId);
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: [
          {
            location_id: hub.stockLocationId,
            inventory_item_id: inventoryItemId,
            stocked_quantity: 100,
          },
        ],
      },
    });
  }

  const headers = { headers: { "x-publishable-api-key": key.token } };
  const cart = await api.post(
    "/store/carts",
    { region_id: regionId, sales_channel_id: channelId, email: "buyer@example.test" },
    headers
  );
  const cartId = String(cart.data.cart.id);
  for (const [index, line] of lines.entries()) {
    await api.post(
      `/store/carts/${cartId}/line-items`,
      { variant_id: variantIds[index], quantity: line.quantity ?? 1 },
      headers
    );
  }
  await api.post(
    `/store/carts/${cartId}`,
    {
      shipping_address: {
        first_name: "Test",
        last_name: "Buyer",
        address_1: "7 Test Street",
        city: "Bengaluru",
        country_code: "in",
        province: "in-ka",
        postal_code: "560001",
        phone: "9876543210",
      },
    },
    headers
  );
  await api.post(
    `/store/carts/${cartId}/shipping-methods`,
    { option_id: hub.shippingOptionId },
    headers
  );

  if (!hub.shippingOptionId) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "[payable-cart] hub location has no shipping option"
    );
  }

  const result: PayableCart = {
    cart_id: cartId,
    region_id: regionId,
    payment_collection_id: null,
    session_id: null,
    razorpay_order_id: null,
    publishable_key: key.token,
    shipping_option_id: hub.shippingOptionId,
    stock_location_id: hub.stockLocationId,
    inventory_item_ids: inventoryItemIds,
    variant_ids: variantIds,
    gateway,
    card: null,
  };
  if (!withPayment) {
    return result;
  }
  if (!options.adminHeaders) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "[payable-cart] adminHeaders are required to save the payment card"
    );
  }
  result.card = await ensureRazorpayCard(api, options.adminHeaders);

  const collection = await api.post("/store/payment-collections", { cart_id: cartId }, headers);
  result.payment_collection_id = String(collection.data.payment_collection.id);
  const withSession = await api.post(
    `/store/payment-collections/${result.payment_collection_id}/payment-sessions`,
    { provider_id: RAZORPAY_PAYMENT_PROVIDER_ID },
    headers
  );
  const session = withSession.data.payment_collection.payment_sessions[0];
  result.session_id = String(session.id);
  result.razorpay_order_id = session.data?.razorpay_order_id ?? null;
  return result;
}