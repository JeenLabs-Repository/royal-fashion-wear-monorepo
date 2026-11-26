import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  RAZORPAY_LEDGER_MODULE,
  RAZORPAY_WEBHOOK_PATH,
  signWebhookBody,
} from "@jeenlabs-repository/medusa-payment-razorpay/public";
import { ensureRazorpayCard, type RazorpayCardSecrets } from "./payable-cart";

type ApiClient = {
  get(url: string, config?: Record<string, unknown>): Promise<{ data: any }>;
  post(url: string, body?: unknown, config?: Record<string, unknown>): Promise<any>;
};

export type EventType = "payment.captured" | "payment.failed" | "order.paid";

export type EventFields = {
  paymentId: string;
  razorpayOrderId: string;
  sessionId: string;
  /** Integer paise as text. */
  amountPaise: string;
};

/** Saves the card with a fake test key and random secrets, and returns them. */
export async function configureRazorpayCard(
  api: ApiClient,
  adminHeaders: Record<string, string>
): Promise<RazorpayCardSecrets> {
  return ensureRazorpayCard(api, adminHeaders);
}

const eventObject = (type: EventType, fields: EventFields) => {
  const failed = type === "payment.failed";
  const payment = {
    id: fields.paymentId,
    entity: "payment",
    amount: Number(fields.amountPaise),
    currency: "INR",
    status: failed ? "failed" : "captured",
    order_id: fields.razorpayOrderId,
    captured: !failed,
    notes: { session_id: fields.sessionId },
    ...(failed
      ? { error_code: "BAD_REQUEST_ERROR", error_description: "Payment failed" }
      : {}),
  };
  const order = {
    id: fields.razorpayOrderId,
    entity: "order",
    amount: Number(fields.amountPaise),
    amount_paid: Number(fields.amountPaise),
    currency: "INR",
    receipt: fields.sessionId,
    status: "paid",
    notes: { session_id: fields.sessionId },
  };
  const payload =
    type === "order.paid"
      ? { payment: { entity: payment }, order: { entity: order } }
      : { payment: { entity: payment } };
  return {
    entity: "event",
    account_id: "acc_test",
    event: type,
    contains: Object.keys(payload),
    payload,
    created_at: 1700000000,
  };
};

/** The raw JSON text of one event, in compact form. */
export function buildEventBody(type: EventType, fields: EventFields): string {
  return JSON.stringify(eventObject(type, fields));
}

/** The same event with irregular spacing and a trailing newline, to prove the raw bytes are checked. */
export function buildSpacedEventBody(type: EventType, fields: EventFields): string {
  return `${JSON.stringify(eventObject(type, fields), null, 4)}\n`;
}

export type PostOptions = {
  secret: string;
  eventId: string;
  /** Sent instead of the computed signature. */
  signatureOverride?: string;
  omitSignature?: boolean;
};

/**
 * Signs the exact string and posts it as a string, so the bytes are never re-serialised.
 * Returns the status and body and never throws on an error status.
 */
export async function signAndPost(
  api: ApiClient,
  rawBody: string,
  options: PostOptions
): Promise<{ status: number; body: any }> {
  const signature = options.signatureOverride ?? signWebhookBody(rawBody, options.secret);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-razorpay-event-id": options.eventId,
  };
  if (!options.omitSignature) {
    headers["x-razorpay-signature"] = signature;
  }
  const response = await api.post(RAZORPAY_WEBHOOK_PATH, rawBody, {
    headers,
    transformRequest: [(data: unknown) => data],
    validateStatus: () => true,
  });
  return { status: response.status, body: response.data };
}

const query = (container: MedusaContainer) =>
  container.resolve(ContainerRegistrationKeys.QUERY) as unknown as {
    graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
  };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Order ids linked to a cart. The admin order list has no cart filter, so this reads the link. */
export async function ordersForCart(container: MedusaContainer, cartId: string): Promise<string[]> {
  const { data } = await query(container).graph({
    entity: "order_cart",
    fields: ["order_id"],
    filters: { cart_id: cartId },
  });
  return data.map((row) => String(row.order_id));
}

/** Polls until an order exists for the cart. Returns an empty list when none appears in time. */
export async function waitForOrder(
  container: MedusaContainer,
  cartId: string,
  timeoutMs = 10_000
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  do {
    const found = await ordersForCart(container, cartId);
    if (found.length > 0) {
      return found;
    }
    await sleep(250);
  } while (Date.now() < deadline);
  return [];
}

/** Polls a condition. Returns whether it became true in time. */
export async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await check()) {
      return true;
    }
    await sleep(250);
  } while (Date.now() < deadline);
  return false;
}

/** A short pause used before asserting that nothing happened. */
export const settle = (ms = 1500) => sleep(ms);

export async function countOrders(container: MedusaContainer): Promise<number> {
  return (await query(container).graph({ entity: "order", fields: ["id"] })).data.length;
}

export type LedgerRow = { event_id: string; status: string; attempts?: number };

// <RESOLVE: field names of the ledger event model. Command:
// grep -n "event_id\|status\|attempts" <plugin repo>/src/modules/razorpay-ledger/models/webhook-event.ts>
export async function ledgerRows(container: MedusaContainer, eventId: string): Promise<LedgerRow[]> {
  const ledger = container.resolve(RAZORPAY_LEDGER_MODULE) as any;
  return ledger.listRazorpayWebhookEvents({ event_id: eventId });
}

/** The browser path, used only by the race case. */
export async function placeOrderViaStore(
  api: ApiClient,
  publishableKey: string,
  cartId: string
): Promise<{ status: number; type: string | null }> {
  const response = await api.post(
    `/store/carts/${cartId}/complete`,
    {},
    { headers: { "x-publishable-api-key": publishableKey }, validateStatus: () => true }
  );
  return { status: response.status, type: response.data?.type ?? null };
}