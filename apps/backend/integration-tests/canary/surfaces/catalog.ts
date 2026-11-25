import path from "node:path";
import { CANARY_VENDORS } from "../canary-strings";
import { ensureCatalogCanary } from "../catalog-canary";
import { CATALOG_CANARY } from "../catalog-strings";
import { collectStarterFields } from "../starter-fields";
import { createRecipeContext } from "../store-routes.recipes";
import { type SurfaceContext, type SurfaceResponse, registerSurface } from "./registry";

// Customer-facing catalog output: product pages in three forms, the product
// image as a URL and as downloaded bytes, the sitemap, llms.txt and every Store
// API request the product page and the search make. The ids are listed in
// `catalog-strings.ts`, and a test fails when the two lists differ.

const STOREFRONT_SRC = path.resolve(__dirname, "..", "..", "..", "..", "storefront", "src");

const text = async (url: string, headers: Record<string, string>): Promise<SurfaceResponse> => {
  const response = await fetch(url, { headers, redirect: "follow" });
  return {
    url,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
};

const storeGet = (context: SurfaceContext, pathAndQuery: string) =>
  text(`${context.backendUrl}${pathAndQuery}`, { "x-publishable-api-key": context.manifest.publishable_key });

const regionId = (context: SurfaceContext) =>
  createRecipeContext(context.backendUrl, context.manifest.publishable_key).regionId();

const productUrl = (context: SurfaceContext, handle: string) =>
  `${context.storefrontUrl}/${context.locale}/products/${handle}`;

const absolute = (context: SurfaceContext, url: string) =>
  /^https?:\/\//.test(url) ? url : `${context.backendUrl}${url.startsWith("/") ? "" : "/"}${url}`;

const JSON_LD = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

registerSurface({
  id: "storefront.product.html",
  kind: "storefront-html",
  owner: "catalog",
  description: "The approved canary product page as HTML",
  minRequests: 1,
  collect: async (context) => {
    const { handle } = await ensureCatalogCanary(context);
    return [await text(productUrl(context, handle), { accept: "text/html" })];
  },
});

registerSurface({
  id: "storefront.product.rsc",
  kind: "storefront-rsc",
  owner: "catalog",
  description: "The same page requested with the RSC header, so streamed props are scanned",
  minRequests: 1,
  collect: async (context) => {
    const { handle } = await ensureCatalogCanary(context);
    return [await text(productUrl(context, handle), { rsc: "1", accept: "text/x-component" })];
  },
});

registerSurface({
  id: "storefront.product.jsonld",
  kind: "storefront-json-ld",
  owner: "catalog",
  description: "Every JSON-LD block on the canary product page",
  minRequests: 1,
  collect: async (context) => {
    const { handle } = await ensureCatalogCanary(context);
    const page = await text(productUrl(context, handle), { accept: "text/html" });
    const responses: SurfaceResponse[] = [];
    let index = 0;
    for (let match = JSON_LD.exec(String(page.body)); match; match = JSON_LD.exec(String(page.body))) {
      JSON.parse(match[1]);
      responses.push({
        url: `${page.url}#jsonld-${index}`,
        status: page.status,
        contentType: "application/ld+json",
        body: match[1],
      });
      index += 1;
    }
    if (responses.length === 0) {
      throw new Error(`${page.url} has no JSON-LD block (status ${page.status})`);
    }
    return responses;
  },
});

registerSurface({
  id: "storefront.product.image.url",
  kind: "image",
  owner: "catalog",
  description: "The public URL of the product image, scanned as text",
  minRequests: 1,
  collect: async (context) => {
    const { imageUrl } = await ensureCatalogCanary(context);
    if (!imageUrl) {
      throw new Error("The canary product has no image URL in the Store API.");
    }
    return [{ url: absolute(context, imageUrl), status: 200, contentType: "text/plain", body: imageUrl }];
  },
});

registerSurface({
  id: "storefront.product.image.bytes",
  kind: "image",
  owner: "catalog",
  description: "The downloaded image bytes, read as latin1 so embedded camera and file names stay searchable",
  minRequests: 1,
  collect: async (context) => {
    const { imageUrl } = await ensureCatalogCanary(context);
    const url = absolute(context, imageUrl);
    const response = await fetch(url);
    return [
      {
        url,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body: Buffer.from(await response.arrayBuffer()),
      },
    ];
  },
});

registerSurface({
  id: "storefront.sitemap.products",
  kind: "sitemap",
  owner: "catalog",
  description: "sitemap.xml after the canary product went live",
  minRequests: 1,
  collect: async (context) => {
    await ensureCatalogCanary(context);
    return [await text(`${context.storefrontUrl}/sitemap.xml`, { accept: "application/xml" })];
  },
});

registerSurface({
  id: "storefront.llms",
  kind: "llms-txt",
  owner: "catalog",
  description: "llms.txt after the canary product went live",
  minRequests: 1,
  collect: async (context) => {
    await ensureCatalogCanary(context);
    return [await text(`${context.storefrontUrl}/llms.txt`, { accept: "text/plain" })];
  },
});

registerSurface({
  id: "store.products.starter-fields",
  kind: "store-api",
  owner: "catalog",
  description: "The storefront's own product `fields` strings, replayed for the canary product",
  minRequests: 1,
  collect: async (context) => {
    const { productId } = await ensureCatalogCanary(context);
    const region = await regionId(context);
    const entries = collectStarterFields(STOREFRONT_SRC).filter((entry) =>
      ["products.ts", "variants.ts"].includes(path.posix.basename(entry.file))
    );
    return Promise.all(
      entries.map((entry) =>
        storeGet(
          context,
          `/store/products?id=${productId}&region_id=${region}&limit=1&fields=${encodeURIComponent(entry.fields)}`
        )
      )
    );
  },
});

registerSurface({
  id: "store.products.minimal-fields",
  kind: "store-api",
  owner: "catalog",
  description: "The product list with minimal fields and with none",
  minRequests: 2,
  collect: async (context) => {
    await ensureCatalogCanary(context);
    return [
      await storeGet(context, "/store/products?limit=50&fields=id,handle,title"),
      await storeGet(context, "/store/products?limit=50"),
    ];
  },
});

registerSurface({
  id: "store.product.by-handle",
  kind: "store-api",
  owner: "catalog",
  description: "The canary product by handle, with the fields the product page asks for",
  minRequests: 1,
  collect: async (context) => {
    const { handle } = await ensureCatalogCanary(context);
    const region = await regionId(context);
    const fields =
      "*variants.calculated_price,+variants.inventory_quantity,*variants.images,*variants.options,+options.values.metadata,+metadata,+tags,*categories";
    return [
      await storeGet(
        context,
        `/store/products?handle=${encodeURIComponent(handle)}&region_id=${region}&fields=${encodeURIComponent(fields)}`
      ),
    ];
  },
});

registerSurface({
  id: "store.ship-from",
  kind: "store-api",
  owner: "catalog",
  description: "The ship-from route for the canary product",
  minRequests: 1,
  collect: async (context) => {
    const { productId } = await ensureCatalogCanary(context);
    return [await storeGet(context, `/store/ship-from?product_ids=${productId}`)];
  },
});

registerSurface({
  id: "store.product-declarations",
  kind: "store-api",
  owner: "catalog",
  description: "The declarations route for the canary product in the default display mode",
  minRequests: 1,
  collect: async (context) => {
    const { productId } = await ensureCatalogCanary(context);
    return [await storeGet(context, `/store/product-declarations?product_ids=${productId}`)];
  },
});

registerSurface({
  id: "store.search.q",
  kind: "store-api",
  owner: "catalog",
  description: "Searches for vendor-only strings; they must find nothing",
  minRequests: 4,
  collect: async (context) => {
    await ensureCatalogCanary(context);
    const needles = [
      CATALOG_CANARY.vendor_sku,
      CATALOG_CANARY.packed_by_name,
      CATALOG_CANARY.generic_name,
      CANARY_VENDORS.alpha.internal_name,
    ];
    return Promise.all(needles.map((needle) => storeGet(context, `/store/products?q=${encodeURIComponent(needle)}&limit=20`)));
  },
});
