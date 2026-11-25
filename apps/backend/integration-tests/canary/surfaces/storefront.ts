import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { type SurfaceContext, type SurfaceResponse, registerSurface } from "./registry";

const APP_DIR = path.resolve(__dirname, "..", "..", "..", "..", "storefront", "src", "app", "[locale]");

// Static page paths from the file system: route groups in parentheses are
// dropped and any folder with a dynamic segment is left to the data-driven list.
export const staticPagePaths = (): string[] => {
  const paths: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    if (existsSync(path.join(dir, "page.tsx"))) {
      paths.push(`/${segments.join("/")}`.replace(/\/$/, "") || "/");
    }
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (!statSync(full).isDirectory() || name.includes("[") || name.startsWith("_") || name === "api") {
        continue;
      }
      walk(full, name.startsWith("(") ? segments : [...segments, name]);
    }
  };
  if (existsSync(APP_DIR)) {
    walk(APP_DIR, []);
  }
  return [...new Set(paths)].sort();
};

const handlesOf = async (surface: SurfaceContext, listPath: string, key: string): Promise<string[]> => {
  const response = await fetch(`${surface.backendUrl}${listPath}?limit=100&fields=handle`, {
    headers: { "x-publishable-api-key": surface.manifest.publishable_key },
  });
  if (!response.ok) {
    throw new Error(`${listPath} answered ${response.status} while listing handles`);
  }
  const body = (await response.json()) as Record<string, { handle?: string }[]>;
  return (body[key] ?? []).map((item) => item.handle).filter((handle): handle is string => Boolean(handle));
};

export const pageUrls = async (surface: SurfaceContext): Promise<string[]> => {
  const prefix = `${surface.storefrontUrl}/${surface.locale}`;
  const urls = staticPagePaths().map((route) => `${prefix}${route === "/" ? "" : route}`);
  for (const handle of await handlesOf(surface, "/store/products", "products")) {
    urls.push(`${prefix}/products/${handle}`);
  }
  for (const handle of await handlesOf(surface, "/store/product-categories", "product_categories")) {
    urls.push(`${prefix}/categories/${handle}`);
  }
  for (const handle of await handlesOf(surface, "/store/collections", "collections")) {
    urls.push(`${prefix}/collections/${handle}`);
  }
  return urls;
};

const fetchPage = async (url: string, headers: Record<string, string>): Promise<SurfaceResponse> => {
  const response = await fetch(url, { headers, redirect: "follow" });
  return {
    url,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
};

const collectHtml = async (surface: SurfaceContext) =>
  Promise.all((await pageUrls(surface)).map((url) => fetchPage(url, { accept: "text/html" })));

const collectRsc = async (surface: SurfaceContext) =>
  Promise.all(
    (await pageUrls(surface)).map((url) => fetchPage(url, { rsc: "1", accept: "text/x-component" }))
  );

const JSON_LD = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const collectJsonLd = async (surface: SurfaceContext): Promise<SurfaceResponse[]> => {
  const responses: SurfaceResponse[] = [];
  for (const url of await pageUrls(surface)) {
    const page = await fetchPage(url, { accept: "text/html" });
    const html = String(page.body);
    let index = 0;
    for (let match = JSON_LD.exec(html); match; match = JSON_LD.exec(html)) {
      try {
        JSON.parse(match[1]);
      } catch {
        throw new Error(`${url} holds a JSON-LD block that does not parse (block ${index})`);
      }
      responses.push({
        url: `${url}#jsonld-${index}`,
        status: page.status,
        contentType: "application/ld+json",
        body: match[1],
      });
      index += 1;
    }
  }
  return responses;
};

const collectOne = (route: string, accept: string) => async (surface: SurfaceContext) => [
  await fetchPage(`${surface.storefrontUrl}${route}`, { accept }),
];

const minPages = Math.max(1, staticPagePaths().length);

registerSurface({
  id: "storefront-pages-html",
  kind: "storefront-html",
  owner: "vendor-domain",
  description: "Every static storefront page and every product, category and collection page as HTML",
  minRequests: minPages,
  collect: collectHtml,
});

registerSurface({
  id: "storefront-pages-rsc",
  kind: "storefront-rsc",
  owner: "vendor-domain",
  description: "The same pages requested with the RSC header, so streamed payloads are scanned",
  minRequests: minPages,
  collect: collectRsc,
});

registerSurface({
  id: "storefront-pages-json-ld",
  kind: "storefront-json-ld",
  owner: "vendor-domain",
  description: "Every application/ld+json block found on those pages",
  minRequests: 1,
  collect: collectJsonLd,
});

registerSurface({
  id: "storefront-sitemap",
  kind: "sitemap",
  owner: "vendor-domain",
  description: "sitemap.xml",
  minRequests: 1,
  collect: collectOne("/sitemap.xml", "application/xml"),
});

registerSurface({
  id: "storefront-llms-txt",
  kind: "llms-txt",
  owner: "vendor-domain",
  description: "llms.txt",
  minRequests: 1,
  collect: collectOne("/llms.txt", "text/plain"),
});
