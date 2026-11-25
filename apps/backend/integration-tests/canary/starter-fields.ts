import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type StarterFields = { file: string; fields: string };

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "node_modules" || name === ".next" ? [] : walk(full);
    }
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });

// Collects every literal `fields: "..."` string in the storefront source, with
// simple string concatenation joined first. Strings with template placeholders
// are dynamic and skipped. Written independently of the store guard's own test
// so the two cannot share a bug.
export const collectStarterFields = (storefrontSrcDir: string): StarterFields[] => {
  const found = new Map<string, StarterFields>();

  for (const file of walk(storefrontSrcDir)) {
    const source = readFileSync(file, "utf8").replace(/(["'`])\s*\+\s*\1/g, "");
    const pattern = /\bfields\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
      const fields = match[2];
      if (fields.includes("${")) {
        continue;
      }
      const relative = path.relative(storefrontSrcDir, file).split(path.sep).join("/");
      found.set(`${relative}::${fields}`, { file: relative, fields });
    }
  }

  return [...found.values()];
};
