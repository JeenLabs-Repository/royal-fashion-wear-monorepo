#!/usr/bin/env node
// Checks that plugins are consumed by exact released versions and never by path.
//   1. a scoped dependency is an exact version, not a range, tag, path, link,
//      workspace or portal reference, and never contains .yalc
//   2. a registry pin that is set equals the version in apps/backend/package.json
//   3. the registry scope is set
//   4. .yalc and yalc.lock are ignored
//   5. the .npmrc holds no literal token and, once wired, the scope line and an
//      auth line that reads the token from the environment
//   6. the lockfile never resolves a scoped package from a local path
//   7. medusa-config.ts never loads a plugin from a local path
// Usage:
//   node scripts/check-plugin-refs.mjs              check this repository, then run the self-test
//   node scripts/check-plugin-refs.mjs --root DIR   check a directory only
//   node scripts/check-plugin-refs.mjs --self-test  run the self-test only
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;
const PATH_LIKE = /^(file:|link:|workspace:|portal:)|\.yalc/;
const LITERAL_TOKEN = /ghp_|github_pat_|_authToken=(?!\$)/;

function readText(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function problemWith(value) {
  if (typeof value !== "string") return "is not a string";
  if (PATH_LIKE.test(value)) return "is a path, link, workspace or local reference";
  if (!EXACT_VERSION.test(value)) return "is not an exact version";
  return "";
}

function packageFiles(root) {
  const files = [path.join(root, "package.json")];
  const appsDir = path.join(root, "apps");
  if (existsSync(appsDir)) {
    for (const name of readdirSync(appsDir)) {
      files.push(path.join(appsDir, name, "package.json"));
    }
  }
  return files.filter((file) => existsSync(file));
}

function findDependency(manifest, packageName) {
  for (const section of DEPENDENCY_SECTIONS) {
    const value = manifest?.[section]?.[packageName];
    if (value !== undefined) return value;
  }
  return undefined;
}

function checkTree(root) {
  const violations = [];
  const registry = readJson(path.join(root, "config", "plugin-registry.json"));
  if (!registry) {
    return ["config/plugin-registry.json is missing or is not valid JSON"];
  }

  const scope = typeof registry.scope === "string" ? registry.scope : "";
  const scopeSet = /^@[a-z0-9][a-z0-9-]*$/.test(scope);
  if (!scopeSet) {
    violations.push(`registry scope is not set (found "${scope}")`);
  }
  const repos = registry.repos ?? {};

  if (scopeSet) {
    for (const file of packageFiles(root)) {
      const label = path.relative(root, file).split(path.sep).join("/");
      const manifest = readJson(file);
      if (!manifest) {
        violations.push(`${label}: not valid JSON`);
        continue;
      }
      for (const section of DEPENDENCY_SECTIONS) {
        for (const [name, value] of Object.entries(manifest[section] ?? {})) {
          if (!name.startsWith(`${scope}/`)) continue;
          const problem = problemWith(value);
          if (problem) violations.push(`${label}: ${section}.${name} "${value}" ${problem}`);
        }
      }
      for (const [key, value] of Object.entries(manifest.pnpm?.overrides ?? {})) {
        if (!key.includes(`${scope}/`)) continue;
        const problem = problemWith(value);
        if (problem) violations.push(`${label}: pnpm.overrides.${key} "${value}" ${problem}`);
      }
    }
  }

  const backend = readJson(path.join(root, "apps", "backend", "package.json"));
  for (const [name, repo] of Object.entries(repos)) {
    if (repo.pin === null || repo.pin === undefined) continue;
    if (!EXACT_VERSION.test(String(repo.pin))) {
      violations.push(`registry pin for ${name} "${repo.pin}" is not an exact version`);
    }
    const found = findDependency(backend, repo.package);
    if (found !== repo.pin) {
      violations.push(
        `registry pin for ${name} is ${repo.pin} but apps/backend/package.json has ${found ?? "no entry"}`
      );
    }
  }

  const config = readText(path.join(root, "apps", "backend", "medusa-config.ts"));
  if (config !== null) {
    if (/\.yalc|["'`]file:/.test(config)) {
      violations.push("apps/backend/medusa-config.ts references a local plugin path");
    }
    for (const name of Object.keys(repos)) {
      const relative = new RegExp(`["'\`]\\.{1,2}/[^"'\`]*${escapeRegExp(name)}`);
      if (relative.test(config)) {
        violations.push(`apps/backend/medusa-config.ts loads ${name} by a relative path`);
      }
    }
  }

  const ignoreLines = (readText(path.join(root, ".gitignore")) ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (!ignoreLines.some((line) => line === ".yalc" || line === ".yalc/" || line === "/.yalc/")) {
    violations.push(".gitignore does not ignore .yalc");
  }
  if (!ignoreLines.includes("yalc.lock")) {
    violations.push(".gitignore does not ignore yalc.lock");
  }

  const npmrc = readText(path.join(root, ".npmrc"));
  if (npmrc !== null && LITERAL_TOKEN.test(npmrc)) {
    violations.push(".npmrc holds a literal token; read it from the environment instead");
  }
  if (registry.npmrc_wired === true) {
    const lines = (npmrc ?? "").split(/\r?\n/).map((line) => line.trim());
    const registryLine = `${scope}:registry=${registry.registry}`;
    if (!lines.includes(registryLine)) {
      violations.push(`.npmrc lacks the line ${registryLine}`);
    }
    const tokenEnv = String(registry.token_env ?? "");
    // The plain form and the two default-value forms all read the environment.
    const references = ["${" + tokenEnv + "}", "${" + tokenEnv + "-}", "${" + tokenEnv + ":-}"];
    const authOk =
      tokenEnv !== "" &&
      lines.some(
        (line) =>
          line.startsWith("//") &&
          line.includes(":_authToken=") &&
          references.some((reference) => line.endsWith(reference))
      );
    if (!authOk) {
      violations.push(`.npmrc lacks an auth line that reads ${references[0]}`);
    }
  }

  const lock = readText(path.join(root, "pnpm-lock.yaml"));
  if (lock !== null && scopeSet) {
    const lines = lock.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.includes(`${scope}/`)) return;
      const stop = Math.min(index + 3, lines.length - 1);
      for (let next = index; next <= stop; next += 1) {
        if (/file:|link:/.test(lines[next])) {
          violations.push(`pnpm-lock.yaml:${next + 1}: a scoped package resolves from a local path`);
          break;
        }
      }
    });
  }

  return violations;
}

function baseFiles() {
  return {
    "config/plugin-registry.json": JSON.stringify(
      {
        registry: "https://npm.pkg.github.com",
        scope: "@acme",
        token_env: "NODE_AUTH_TOKEN",
        npmrc_wired: false,
        repos: {
          "medusa-payment-razorpay": {
            package: "@acme/medusa-payment-razorpay",
            description: "x",
            pin: null,
            planned: false,
          },
          "medusa-store-settings": {
            package: "@acme/medusa-store-settings",
            description: "x",
            pin: null,
            planned: false,
          },
        },
      },
      null,
      2
    ),
    "package.json": JSON.stringify({ name: "root", private: true }),
    "apps/backend/package.json": JSON.stringify({
      name: "backend",
      dependencies: { "@acme/medusa-payment-razorpay": "0.1.0" },
    }),
    "apps/backend/medusa-config.ts": "module.exports = {};\n",
    ".gitignore": "node_modules\n.yalc/\nyalc.lock\n",
    ".npmrc": "auto-install-peers=true\n",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  };
}

function edited(files, name, change) {
  const next = { ...files };
  const parsed = JSON.parse(next[name]);
  change(parsed);
  next[name] = JSON.stringify(parsed, null, 2);
  return next;
}

function withDependency(value, section = "dependencies") {
  return (files) =>
    edited(files, "apps/backend/package.json", (manifest) => {
      manifest[section] = { "@acme/medusa-payment-razorpay": value };
    });
}

const WIRED_NPMRC =
  "auto-install-peers=true\n@acme:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n";

const WIRED_NPMRC_DEFAULT =
  "auto-install-peers=true\n@acme:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN-}\n";

function wired(npmrc) {
  return (files) => ({
    ...edited(files, "config/plugin-registry.json", (registry) => {
      registry.npmrc_wired = true;
    }),
    ".npmrc": npmrc,
  });
}

// Each case builds a temporary repository root from the clean base, changes it,
// and runs the same code path as --root.
const CASES = [
  { name: "exact version passes", mutate: (f) => f, fails: false },
  ...["^0.1.0", "~0.1.0", "latest", "file:../x", "link:../x", "workspace:*", "portal:../x", "../.yalc/x"].map(
    (value) => ({
      name: `dependency value ${value} fails`,
      mutate: withDependency(value),
      fails: true,
    })
  ),
  { name: "range in devDependencies fails", mutate: withDependency("^0.1.0", "devDependencies"), fails: true },
  {
    name: "path in pnpm overrides fails",
    mutate: (f) =>
      edited(f, "package.json", (manifest) => {
        manifest.pnpm = { overrides: { "@acme/medusa-store-settings": "file:../x" } };
      }),
    fails: true,
  },
  {
    name: "matching pin passes",
    mutate: (f) =>
      edited(f, "config/plugin-registry.json", (registry) => {
        registry.repos["medusa-payment-razorpay"].pin = "0.1.0";
      }),
    fails: false,
  },
  {
    name: "pin that differs from the dependency fails",
    mutate: (f) =>
      edited(f, "config/plugin-registry.json", (registry) => {
        registry.repos["medusa-payment-razorpay"].pin = "0.1.1";
      }),
    fails: true,
  },
  {
    name: "pin without the package fails",
    mutate: (f) =>
      edited(f, "config/plugin-registry.json", (registry) => {
        registry.repos["medusa-store-settings"].pin = "0.2.0";
      }),
    fails: true,
  },
  {
    name: "null pin with the package present passes",
    mutate: (f) => f,
    fails: false,
  },
  {
    name: "empty scope fails",
    mutate: (f) =>
      edited(f, "config/plugin-registry.json", (registry) => {
        registry.scope = "";
      }),
    fails: true,
  },
  {
    name: "bare at sign scope fails",
    mutate: (f) =>
      edited(f, "config/plugin-registry.json", (registry) => {
        registry.scope = "@";
      }),
    fails: true,
  },
  { name: "gitignore without .yalc fails", mutate: (f) => ({ ...f, ".gitignore": "yalc.lock\n" }), fails: true },
  { name: "gitignore without yalc.lock fails", mutate: (f) => ({ ...f, ".gitignore": ".yalc/\n" }), fails: true },
  { name: "wired npmrc with both lines passes", mutate: wired(WIRED_NPMRC), fails: false },
  { name: "wired npmrc with the default-value auth form passes", mutate: wired(WIRED_NPMRC_DEFAULT), fails: false },
  {
    name: "wired npmrc without the registry line fails",
    mutate: wired("//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n"),
    fails: true,
  },
  {
    name: "wired npmrc without the auth line fails",
    mutate: wired("@acme:registry=https://npm.pkg.github.com\n"),
    fails: true,
  },
  {
    name: "literal github token fails",
    mutate: (f) => ({ ...f, ".npmrc": "//npm.pkg.github.com/:_authToken=" + "ghp_" + "a".repeat(8) + "\n" }),
    fails: true,
  },
  {
    name: "literal auth value fails",
    mutate: (f) => ({ ...f, ".npmrc": "//npm.pkg.github.com/:_authToken=abc123\n" }),
    fails: true,
  },
  {
    name: "lockfile with a yalc path fails",
    mutate: (f) => ({
      ...f,
      "pnpm-lock.yaml":
        "importers:\n  apps/backend:\n    dependencies:\n      '@acme/medusa-store-settings':\n        specifier: file:.yalc/@acme/medusa-store-settings\n",
    }),
    fails: true,
  },
  {
    name: "lockfile with a link fails",
    mutate: (f) => ({
      ...f,
      "pnpm-lock.yaml":
        "importers:\n  apps/backend:\n    dependencies:\n      '@acme/medusa-store-settings':\n        version: link:../x\n",
    }),
    fails: true,
  },
  {
    name: "lockfile with a registry resolution passes",
    mutate: (f) => ({
      ...f,
      "pnpm-lock.yaml":
        "packages:\n  '@acme/medusa-store-settings@0.2.0':\n    resolution: {integrity: sha512-abc}\n",
    }),
    fails: false,
  },
  {
    name: "medusa-config with a yalc path fails",
    mutate: (f) => ({ ...f, "apps/backend/medusa-config.ts": 'resolve: ".yalc/@acme/medusa-store-settings"\n' }),
    fails: true,
  },
  {
    name: "medusa-config with a relative plugin path fails",
    mutate: (f) => ({ ...f, "apps/backend/medusa-config.ts": 'resolve: "../medusa-store-settings"\n' }),
    fails: true,
  },
];

function selfTest() {
  let failures = 0;
  for (const testCase of CASES) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plugin-refs-"));
    try {
      const files = testCase.mutate(baseFiles());
      for (const [name, content] of Object.entries(files)) {
        const target = path.join(dir, name);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
      const violations = checkTree(dir);
      const failed = violations.length > 0;
      if (failed === testCase.fails) {
        console.log(`[PASS] ${testCase.name}`);
      } else {
        failures += 1;
        console.log(`[FAIL] ${testCase.name}`);
        for (const line of violations) console.log(`       ${line}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return failures;
}

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const selfTestOnly = args.includes("--self-test");
let failed = 0;

if (!selfTestOnly) {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const root =
    rootIndex === -1 ? path.resolve(scriptsDir, "..") : path.resolve(args[rootIndex + 1] ?? ".");
  const violations = checkTree(root);
  if (violations.length > 0) {
    console.log(violations.join("\n"));
    console.log(`check-plugin-refs: ${violations.length} violations`);
    failed += violations.length;
  } else {
    console.log("check-plugin-refs: plugin references are exact and path-free");
  }
}

if (rootIndex === -1) {
  failed += selfTest();
}

process.exit(failed === 0 ? 0 : 1);
