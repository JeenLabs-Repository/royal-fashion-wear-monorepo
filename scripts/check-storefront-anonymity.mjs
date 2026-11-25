#!/usr/bin/env node
// Fails when customer-facing storefront output could carry vendor-derived or
// metadata-derived text. Plain text checks, no dependencies.
//
//   node scripts/check-storefront-anonymity.mjs [--root <dir>]
//
// The root defaults to the repository root. A different root lets the checks
// run against a temporary copy, which is how the mutation proofs work.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const rootFlag = args.indexOf("--root");
const root = path.resolve(
  rootFlag >= 0 && args[rootFlag + 1]
    ? args[rootFlag + 1]
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
);

const SRC = "apps/storefront/src";
const failures = [];

const fail = (file, line, message) => {
  failures.push(`${file}${line ? `:${line}` : ""}: ${message}`);
};

const read = (relative) => {
  const full = path.join(root, relative);
  if (!existsSync(full)) {
    fail(relative, 0, "file is missing");
    return null;
  }
  return readFileSync(full, "utf8");
};

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

// Blank out comments but keep every newline, so line numbers stay right and
// words inside comments never count as code.
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const fieldStrings = (text) => {
  const found = [];
  const pattern = /\bfields\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    found.push({ value: match[2], line: lineOf(text, match.index), index: match.index });
  }
  return found;
};

// (a) and (b) JSON-LD takes the brand from the store name and reads exactly
// one metadata field, mapped through a fixed table.
const jsonLdFile = `${SRC}/lib/util/json-ld.ts`;
const jsonLd = read(jsonLdFile);
if (jsonLd !== null) {
  const body = code(jsonLd);

  for (const match of body.matchAll(/\bmeta\.(\w+)/g)) {
    if (match[1] !== "condition") {
      fail(jsonLdFile, lineOf(body, match.index), `reads metadata field "${match[1]}"; only "condition" is allowed`);
    }
  }
  for (const match of body.matchAll(/\bmeta\s*\[/g)) {
    fail(jsonLdFile, lineOf(body, match.index), "reads metadata by a computed key");
  }
  for (const match of body.matchAll(/\bmpn\b/g)) {
    fail(jsonLdFile, lineOf(body, match.index), "emits a part number");
  }

  const metadataReads = [...body.matchAll(/\.metadata\b/g)];
  if (metadataReads.length !== 1) {
    fail(jsonLdFile, 0, `expected exactly one read of product metadata, found ${metadataReads.length}`);
  }

  const brandLines = body.split("\n").flatMap((text, index) =>
    /"@type"\s*:\s*"Brand"/.test(text) ? [{ text, line: index + 1 }] : []
  );
  if (brandLines.length === 0) {
    fail(jsonLdFile, 0, "no brand node found");
  }
  for (const { text, line } of brandLines) {
    if (!/name\s*:\s*SITE_NAME\b/.test(text)) {
      fail(jsonLdFile, line, "the brand node must take its name from SITE_NAME only");
    }
  }
  if (!/CONDITIONS\s*\[/.test(body)) {
    fail(jsonLdFile, 0, "condition must be mapped through the fixed CONDITIONS table");
  }
}

// (c) llms.txt asks for handle, title and description of products and builds
// the item description from the description only.
const llmsFile = `${SRC}/app/llms.txt/route.ts`;
const llms = read(llmsFile);
if (llms !== null) {
  const body = code(llms);
  const at = body.indexOf('"/store/products"');
  const productFields = at >= 0 ? fieldStrings(body.slice(at, at + 400)) : [];
  if (productFields.length !== 1 || productFields[0].value !== "handle,title,description") {
    fail(
      llmsFile,
      at >= 0 ? lineOf(body, at) : 0,
      `the product fields must be exactly "handle,title,description", found ${JSON.stringify(
        productFields.map((entry) => entry.value)
      )}`
    );
  }
  for (const match of body.matchAll(/\bsubtitle\b/g)) {
    fail(llmsFile, lineOf(body, match.index), "reads a product subtitle");
  }
  if (!/\bp\.description\b/.test(body)) {
    fail(llmsFile, 0, "the product item description must be built from the description");
  }
}

// (d) The sitemap asks for handle and update time only.
const sitemapFile = `${SRC}/app/sitemap.ts`;
const sitemap = read(sitemapFile);
if (sitemap !== null) {
  const entries = fieldStrings(code(sitemap));
  if (entries.length === 0) {
    fail(sitemapFile, 0, "no fields string found");
  }
  for (const entry of entries) {
    if (entry.value !== "handle,updated_at") {
      fail(sitemapFile, entry.line, `fields must be exactly "handle,updated_at", found "${entry.value}"`);
    }
  }
}

// (e) Search reads approver-reviewed title and description only.
const productsFile = `${SRC}/lib/data/products.ts`;
const products = read(productsFile);
if (products !== null) {
  const body = code(products);
  const at = body.indexOf("export const searchProducts");
  if (at < 0) {
    fail(productsFile, 0, "searchProducts not found");
  } else {
    const entries = fieldStrings(body.slice(at));
    const first = entries[0];
    if (!first || first.value !== "id,title,description") {
      fail(
        productsFile,
        first ? lineOf(body, at + first.index) : lineOf(body, at),
        `searchProducts must query exactly "id,title,description", found "${first ? first.value : "nothing"}"`
      );
    }
  }
}

// (f) The two anonymous data functions never carry credentials.
for (const name of ["ship-from.ts", "product-declarations.ts"]) {
  const file = `${SRC}/lib/data/${name}`;
  const text = read(file);
  if (text === null) continue;
  const body = code(text);
  for (const match of body.matchAll(/getAuthHeaders|authorization|\bcookies\b|from\s+["']\.\/cookies["']/gi)) {
    fail(file, lineOf(body, match.index), `"${match[0]}" is not allowed in an anonymous data function`);
  }
  if (!/\/store\//.test(body)) {
    fail(file, 0, "no store route call found");
  }
}

// (g) No page code renders product metadata. JSON-LD is the one reader and
// check (a) pins it to a single field.
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "node_modules" || name === ".next" ? [] : walk(full);
    }
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });

const srcDir = path.join(root, SRC);
if (!existsSync(srcDir)) {
  fail(SRC, 0, "folder is missing");
} else {
  for (const full of walk(srcDir)) {
    const relative = path.relative(root, full).split(path.sep).join("/");
    if (relative === jsonLdFile) continue;
    const body = code(readFileSync(full, "utf8"));
    for (const match of body.matchAll(/\bproduct\??\.metadata\b/g)) {
      fail(relative, lineOf(body, match.index), "reads product metadata");
    }
  }
}

if (failures.length > 0) {
  console.error(`check-storefront-anonymity: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("check-storefront-anonymity: ok");
