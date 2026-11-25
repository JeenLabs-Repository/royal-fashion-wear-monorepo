import path from "node:path";
import { enumerateStoreRoutes } from "../enumerate-store-routes";
import { collectStarterFields } from "../starter-fields";
import {
  RECIPES,
  STARTER_FIELD_ROUTES,
  type Recipe,
  type RecipeContext,
  createRecipeContext,
} from "../store-routes.recipes";
import { type SurfaceContext, type SurfaceResponse, registerSurface } from "./registry";

const STOREFRONT_SRC = path.resolve(__dirname, "..", "..", "..", "..", "storefront", "src");

const get = async (
  context: RecipeContext,
  url: string,
  token?: string
): Promise<SurfaceResponse> => {
  const response = await fetch(url, {
    headers: { ...context.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return {
    url,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
};

const resolveUrl = async (
  context: RecipeContext,
  pattern: string,
  recipe: Recipe,
  extra: Record<string, string> = {}
): Promise<string> => {
  let resolved = pattern;
  for (const [name, resolve] of Object.entries(recipe.params ?? {})) {
    resolved = resolved.replace(`:${name}`, encodeURIComponent(await resolve(context)));
  }
  if (resolved.includes("/:")) {
    throw new Error(`The recipe for ${pattern} does not resolve every parameter.`);
  }
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(recipe.query ?? {})) {
    query.set(name, typeof value === "string" ? value : await value(context));
  }
  for (const [name, value] of Object.entries(extra)) {
    query.set(name, value);
  }
  const text = query.toString();
  return `${context.backendUrl}${resolved}${text ? `?${text}` : ""}`;
};

const tokenFor = (context: RecipeContext, recipe: Recipe) =>
  recipe.auth === "customer" ? context.customerToken() : Promise.resolve(undefined);

const collectRoutes = async (surface: SurfaceContext): Promise<SurfaceResponse[]> => {
  const context = createRecipeContext(surface.backendUrl, surface.manifest.publishable_key);
  const routes = enumerateStoreRoutes();

  const unmapped = routes.filter((route) => !(route.pattern in RECIPES));
  if (unmapped.length > 0) {
    throw new Error(
      `Store API GET routes without a recipe or a skip:\n${unmapped
        .map((route) => `- ${route.pattern} (${route.source})`)
        .join("\n")}\nAdd an entry to integration-tests/canary/store-routes.recipes.ts: a recipe that builds a valid request, or { skip: "<reason>" }.`
    );
  }

  const responses: SurfaceResponse[] = [];
  for (const route of routes) {
    const recipe = RECIPES[route.pattern];
    if (recipe.skip) {
      continue;
    }
    const url = await resolveUrl(context, route.pattern, recipe);
    responses.push(await get(context, url, await tokenFor(context, recipe)));
  }
  return responses;
};

const collectStarterFieldRequests = async (surface: SurfaceContext): Promise<SurfaceResponse[]> => {
  const context = createRecipeContext(surface.backendUrl, surface.manifest.publishable_key);
  const entries = collectStarterFields(STOREFRONT_SRC);
  const responses: SurfaceResponse[] = [];

  for (const entry of entries) {
    const base = path.posix.basename(entry.file);
    const patterns = STARTER_FIELD_ROUTES[base];
    if (!patterns) {
      throw new Error(
        `The storefront file ${entry.file} sets \`fields\` but has no entry in STARTER_FIELD_ROUTES. Map it to the Store API route it reads.`
      );
    }
    for (const pattern of patterns) {
      const recipe = RECIPES[pattern];
      if (!recipe || recipe.skip) {
        continue;
      }
      const url = await resolveUrl(context, pattern, recipe, { fields: entry.fields, limit: "1" });
      responses.push(await get(context, url, await tokenFor(context, recipe)));
    }
  }
  return responses;
};

registerSurface({
  id: "store-api-get-routes",
  kind: "store-api",
  owner: "vendor-domain",
  description:
    "Every GET route of the installed Store API and the project, requested plainly with a publishable key",
  minRequests: 10,
  collect: collectRoutes,
});

registerSurface({
  id: "store-api-starter-fields",
  kind: "store-api",
  owner: "vendor-domain",
  description: "The storefront's own `fields` strings replayed against the route each one was written for",
  minRequests: 3,
  collect: collectStarterFieldRequests,
});
