export type GatewayPayment = {
  id: string;
  entity: "payment";
  amount: number;
  currency: "INR";
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  order_id: string | null;
  amount_refunded: number;
  captured: boolean;
  created_at: number;
};

export type GatewayRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};

export type ScriptedReply = { status: number; body: unknown };

export type GatewayScript = {
  payments: Map<string, GatewayPayment>;
  requests: GatewayRequest[];
  /** Replies consumed in order by the next refund requests; then the default reply is used. */
  refundReplies: ScriptedReply[];
  /** Refund bodies the script has answered with success, in order. */
  refundsCreated: { id: string; payment_id: string; amount: number; status: string }[];
  /** Overrides the payments list: return the rows for one page. */
  listOverride: ((skip: number, count: number) => unknown[]) | null;
  refundRequests(): GatewayRequest[];
  restore(): void;
};

export const gatewayPayment = (
  id: string,
  orderId: string | null,
  amountPaise: number,
  status: GatewayPayment["status"] = "captured",
  amountRefunded = 0
): GatewayPayment => ({
  id,
  entity: "payment",
  amount: amountPaise,
  currency: "INR",
  status,
  order_id: orderId,
  amount_refunded: amountRefunded,
  captured: status === "captured" || status === "refunded",
  created_at: Math.floor(Date.now() / 1000) - 60,
});

const HOST = "https://api.razorpay.com/";

const headerRecord = (headers: unknown): Record<string, string> => {
  const record: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      record[key.toLowerCase()] = value;
    });
  } else if (headers && typeof headers === "object") {
    for (const [key, value] of Object.entries(headers as Record<string, string>)) {
      record[key.toLowerCase()] = String(value);
    }
  }
  return record;
};

const json = (reply: ScriptedReply): Response =>
  new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "content-type": "application/json" },
  });

export function installGatewayScript(): GatewayScript {
  const realFetch = globalThis.fetch;
  let refundCounter = 0;

  const script: GatewayScript = {
    payments: new Map(),
    requests: [],
    refundReplies: [],
    refundsCreated: [],
    listOverride: null,
    refundRequests: () =>
      script.requests.filter((request) => request.method === "POST" && /\/refund$/.test(request.path)),
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!url.startsWith(HOST)) {
      return realFetch(input, init);
    }
    const method = (init?.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/v1\//, "");
    let body: unknown = null;
    if (typeof init?.body === "string" && init.body.length > 0) {
      body = JSON.parse(init.body);
    }
    script.requests.push({ method, path, headers: headerRecord(init?.headers), body });

    if (method === "GET" && path === "payments") {
      const skip = Number(parsed.searchParams.get("skip") ?? 0);
      const count = Number(parsed.searchParams.get("count") ?? 10);
      const items = script.listOverride
        ? script.listOverride(skip, count)
        : [...script.payments.values()].slice(skip, skip + count);
      return json({ status: 200, body: { entity: "collection", count: items.length, items } });
    }

    const refundMatch = /^payments\/([^/]+)\/refund$/.exec(path);
    if (method === "POST" && refundMatch) {
      const scripted = script.refundReplies.shift();
      if (scripted) {
        return json(scripted);
      }
      refundCounter += 1;
      const refund = {
        id: `rfnd_TEST${String(refundCounter).padStart(4, "0")}`,
        entity: "refund",
        payment_id: refundMatch[1],
        amount: (body as { amount?: number } | null)?.amount ?? 0,
        status: "pending",
      };
      script.refundsCreated.push(refund);
      return json({ status: 200, body: refund });
    }

    const paymentMatch = /^payments\/([^/]+)$/.exec(path);
    if (method === "GET" && paymentMatch) {
      const found = script.payments.get(paymentMatch[1]);
      return found
        ? json({ status: 200, body: found })
        : json({
            status: 404,
            body: { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } },
          });
    }

    return json({
      status: 404,
      body: { error: { code: "BAD_REQUEST_ERROR", description: `unscripted ${method} ${path}` } },
    });
  }) as typeof fetch;

  return script;
}
