export type RecipeContext = {
  backendUrl: string;
  headers: Record<string, string>;
  regionId: () => Promise<string>;
  cartId: () => Promise<string>;
  firstId: (listPath: string, key: string) => Promise<string>;
  customerToken: () => Promise<string>;
};

type Resolver = (context: RecipeContext) => Promise<string>;

export type Recipe = {
  params?: Record<string, Resolver>;
  query?: Record<string, string | Resolver>;
  auth?: "customer";
  skip?: string;
};

export const createRecipeContext = (backendUrl: string, publishableKey: string): RecipeContext => {
  const headers = { "x-publishable-api-key": publishableKey, "content-type": "application/json" };
  const memo = new Map<string, Promise<string>>();
  const once = (key: string, load: () => Promise<string>): Promise<string> => {
    if (!memo.has(key)) {
      memo.set(key, load());
    }
    return memo.get(key) as Promise<string>;
  };

  const json = async (path: string, init: RequestInit = {}): Promise<Record<string, any>> => {
    const response = await fetch(`${backendUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${init.method ?? "GET"} ${path} answered ${response.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
  };

  const context: RecipeContext = {
    backendUrl,
    headers,
    firstId: (listPath, key) =>
      once(`first:${listPath}:${key}`, async () => {
        const body = await json(`${listPath}?limit=1&fields=id`);
        const id = body[key]?.[0]?.id;
        if (!id) {
          throw new Error(`No ${key} found at ${listPath}. Seed the starter data first.`);
        }
        return id as string;
      }),
    regionId: () => context.firstId("/store/regions", "regions"),
    cartId: () =>
      once("cart", async () => {
        const region = await context.regionId();
        const body = await json("/store/carts", { method: "POST", body: JSON.stringify({ region_id: region }) });
        return body.cart.id as string;
      }),
    customerToken: () =>
      once("customer-token", async () => {
        const email = `canary-customer-${Date.now()}@example.test`;
        const password = "Canary-Customer-Passw0rd-2026";
        const registered = await json("/auth/customer/emailpass/register", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        await json("/store/customers", {
          method: "POST",
          headers: { authorization: `Bearer ${registered.token}` },
          body: JSON.stringify({ email, first_name: "Canary", last_name: "Customer" }),
        });
        const login = await json("/auth/customer/emailpass", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        return login.token as string;
      }),
  };
  return context;
};

const REGION: Resolver = (context) => context.regionId();
const CART: Resolver = (context) => context.cartId();

// One entry per Store API GET route of the installed core package and the
// project. A route that is not listed fails the crawl until you add a recipe or
// a skip with a real reason. Patterns the installed version does not have are ignored.
export const RECIPES: Record<string, Recipe> = {
  "/store/regions": {},
  "/store/regions/:id": { params: { id: REGION } },
  "/store/collections": {},
  "/store/collections/:id": { params: { id: (c) => c.firstId("/store/collections", "collections") } },
  "/store/product-categories": {},
  "/store/product-categories/:id": {
    params: { id: (c) => c.firstId("/store/product-categories", "product_categories") },
  },
  "/store/product-tags": {},
  "/store/product-tags/:id": {
    skip: "the India starter catalog defines no product tags: list route still crawled; detail covered when tags exist",
  },
  "/store/product-types": {},
  "/store/product-types/:id": {
    skip: "the India starter catalog defines no product types: list route still crawled; detail covered when types exist",
  },
  "/store/product-options": {},
  "/store/product-options/:id": {
    params: { id: (c) => c.firstId("/store/product-options", "product_options") },
  },
  "/store/product-variants": { query: { limit: "20", region_id: REGION } },
  "/store/product-variants/:id": {
    params: { id: (c) => c.firstId("/store/product-variants", "variants") },
    query: { region_id: REGION },
  },
  "/store/products": { query: { limit: "20", region_id: REGION } },
  "/store/products/:id": {
    params: { id: (c) => c.firstId("/store/products", "products") },
    query: { region_id: REGION },
  },
  "/store/ship-from": {
    query: { product_ids: (c) => c.firstId("/store/products", "products") },
  },
  "/store/product-declarations": {
    query: { product_ids: (c) => c.firstId("/store/products", "products") },
  },
  "/store/currencies": {},
  "/store/currencies/:code": { params: { code: async () => "inr" } },
  "/store/payment-providers": { query: { region_id: REGION } },
  "/store/shipping-options": { query: { cart_id: CART } },
  "/store/carts/:id": { params: { id: CART } },
  "/store/locales": {},
  "/store/return-reasons": {},
  "/store/return-reasons/:id": {
    skip: "the starter dataset defines no return reasons: covered by the order surface once returns exist",
  },
  "/store/customers/me": { auth: "customer" },
  "/store/customers/me/addresses": { auth: "customer" },
  "/store/customers/me/addresses/:address_id": {
    skip: "the fresh canary customer has no saved address: covered by the order surface when addresses exist",
  },
  "/store/orders": { auth: "customer" },
  "/store/orders/:id": {
    skip: "requires an order that does not exist in this dataset: covered by the order surface when orders exist",
  },
};

// Every skip needs a written reason. This runs when the module loads.
for (const [pattern, recipe] of Object.entries(RECIPES)) {
  if ("skip" in recipe && (typeof recipe.skip !== "string" || recipe.skip.trim() === "")) {
    throw new Error(`The recipe for ${pattern} skips without a reason.`);
  }
}

// Which storefront file reads which Store API route, so each `fields` string
// is replayed against the route it was written for. Keys are either the file
// basename (unique lib/data modules) or the path under src/ when the basename
// alone would collide (route.ts, index.tsx).
export const STARTER_FIELD_ROUTES: Record<string, string[]> = {
  "products.ts": ["/store/products"],
  "variants.ts": ["/store/products"],
  "categories.ts": ["/store/product-categories"],
  "collections.ts": ["/store/collections"],
  "regions.ts": ["/store/regions"],
  "cart.ts": ["/store/carts/:id"],
  "express-checkout.ts": ["/store/carts/:id"],
  "orders.ts": ["/store/orders"],
  "fulfillment.ts": ["/store/shipping-options"],
  "customer.ts": ["/store/customers/me"],
  "payment.ts": ["/store/payment-providers"],
  "sitemap.ts": ["/store/products", "/store/product-categories", "/store/collections"],
  "app/api/payment-return/route.ts": ["/store/carts/:id"],
  "app/llms.txt/route.ts": ["/store/collections", "/store/product-categories", "/store/products"],
  "modules/home/components/featured-products/product-rail/index.tsx": ["/store/products"],
};
