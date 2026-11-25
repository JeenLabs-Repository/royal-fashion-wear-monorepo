import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keeps the container image rules true: exact Node tag, no production
// environment during builds, a non-root runtime user, a health check, frozen
// lockfile installs, no secret build arguments and telemetry switched off.

const NODE_TAG_PREFIX = "node:22.23.4";
const SKIPPED_DIRS = new Set(["node_modules", ".next", ".medusa"]);
const SECRET_WORDS = /SECRET|PASSWORD|TOKEN|PRIVATE/i;
const TOKEN_VARIABLE = "NODE_AUTH_TOKEN";
const MANIFEST_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// True when the backend manifest holds any dependency of the plugin scope, which
// turns the optional registry credential into a required one.
function hasPluginDependency(root) {
  const registry = readJson(path.join(root, "config", "plugin-registry.json"));
  const manifest = readJson(path.join(root, "apps", "backend", "package.json"));
  if (!registry || !manifest || typeof registry.scope !== "string" || registry.scope === "") {
    return false;
  }
  const prefix = `${registry.scope}/`;
  return MANIFEST_SECTIONS.some((section) =>
    Object.keys(manifest[section] ?? {}).some((name) => name.startsWith(prefix)),
  );
}

// Every secret mount of the token variable on a RUN line, as the option text.
function tokenMounts(line) {
  return (line.match(/--mount=type=secret[^\s]*/g) ?? []).filter((mount) =>
    new RegExp(`(^|,)id=${TOKEN_VARIABLE}(,|$)`).test(mount.replace("--mount=", "")),
  );
}

function parseRoot() {
  const flag = process.argv.indexOf("--root");
  if (flag !== -1 && process.argv[flag + 1]) {
    return path.resolve(process.argv[flag + 1]);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function findDockerfiles(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findDockerfiles(full, found);
    else if (entry.name === "Dockerfile") found.push(full);
  }
  return found;
}

// Joins continuation lines and drops comments, then groups instructions by stage.
function parseStages(text) {
  const joined = text.replace(/\\\r?\n/g, " ");
  const instructions = joined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const stages = [];
  for (const line of instructions) {
    if (/^FROM\s/i.test(line)) {
      const parts = line.split(/\s+/).filter((part) => !part.startsWith("--"));
      const image = parts[1];
      const asIndex = parts.findIndex((part) => part.toUpperCase() === "AS");
      const name = asIndex === -1 ? undefined : parts[asIndex + 1];
      stages.push({ image, name, instructions: [] });
    } else if (stages.length > 0) {
      stages[stages.length - 1].instructions.push(line);
    }
  }
  return stages;
}

const setsProduction = (line) =>
  /^ENV\s/i.test(line) && /NODE_ENV\s*=?\s*["']?production/i.test(line);

function checkFile(file, root) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const stages = parseStages(fs.readFileSync(file, "utf8"));
  const text = fs.readFileSync(file, "utf8");
  const stageNames = new Set(stages.map((stage) => stage.name).filter(Boolean));
  const last = stages[stages.length - 1];
  const results = [];

  if (stages.length === 0) {
    return [{ name: "has at least one FROM", ok: false, detail: "", relative }];
  }

  const rule = (name, ok, detail = "") => results.push({ name, ok, detail });

  const badFrom = stages.filter((stage) => {
    if (stageNames.has(stage.image)) return false;
    const tag = stage.image.split(":")[1];
    if (!tag || tag === "latest") return true;
    if (stage.image.startsWith("node:")) {
      return !stage.image.startsWith(NODE_TAG_PREFIX);
    }
    return false;
  });
  rule(
    "every FROM has a fixed tag and Node is 22.23.4",
    badFrom.length === 0,
    badFrom.map((stage) => stage.image).join(", "),
  );

  const earlyProduction = stages
    .slice(0, -1)
    .filter((stage) => stage.instructions.some(setsProduction));
  rule(
    "only the last stage sets the production environment",
    earlyProduction.length === 0,
    earlyProduction.map((stage) => stage.name ?? stage.image).join(", "),
  );

  const users = last.instructions.filter((line) => /^USER\s/i.test(line));
  const lastUser = users.length
    ? users[users.length - 1].split(/\s+/)[1]
    : "root";
  rule(
    "the last stage sets production, runs as non-root, has a health check and a CMD",
    last.instructions.some(setsProduction) &&
      !["root", "0"].includes(lastUser) &&
      last.instructions.some((line) => /^HEALTHCHECK\s/i.test(line)) &&
      last.instructions.some((line) => /^CMD\s/i.test(line)),
  );

  const unfrozen = stages
    .flatMap((stage) => stage.instructions)
    .filter(
      (line) => /pnpm\s+install/.test(line) && !line.includes("--frozen-lockfile"),
    );
  rule("pnpm install uses --frozen-lockfile", unfrozen.length === 0, unfrozen.join("; "));

  const secretArgs = stages
    .flatMap((stage) => stage.instructions)
    .filter((line) => /^ARG\s/i.test(line))
    .map((line) => line.split(/\s+/)[1].split("=")[0])
    .filter((name) => SECRET_WORDS.test(name));
  rule("no build argument looks like a secret", secretArgs.length === 0, secretArgs.join(", "));

  let telemetryOk = true;
  let telemetryNeed = "no telemetry rule for this file";
  if (relative.includes("backend")) {
    telemetryNeed = "GORGO_DISABLE_TELEMETRY=true";
    telemetryOk = text.includes(telemetryNeed);
  } else if (relative.includes("storefront")) {
    telemetryNeed = "NEXT_TELEMETRY_DISABLED=1";
    telemetryOk = text.includes(telemetryNeed);
  }
  rule(`telemetry is disabled (${telemetryNeed})`, telemetryOk);

  const allInstructions = stages.flatMap((stage) => stage.instructions);

  // Rule 7: the backend reads the registry credential only through a secret
  // mount on every install and deploy step. The mount is required as soon as a
  // plugin dependency exists. Other Dockerfiles need no mount.
  let mountOk = true;
  let mountDetail = "";
  if (relative.includes("backend")) {
    const required = hasPluginDependency(root);
    const steps = allInstructions.filter(
      (line) => /^RUN\s/i.test(line) && (/pnpm\s+install/.test(line) || /pnpm\b.*\bdeploy\b/.test(line)),
    );
    const bad = steps.filter((line) => {
      const mounts = tokenMounts(line);
      if (mounts.length === 0) return true;
      return required && !mounts.every((mount) => /(^|,)required=true(,|$)/.test(mount));
    });
    mountOk = steps.length > 0 && bad.length === 0;
    mountDetail = steps.length === 0
      ? "no install or deploy step found"
      : bad.map((line) => line.slice(0, 80)).join("; ");
  }
  rule(
    "install and deploy steps mount the registry credential as a secret (required once a plugin dependency exists)",
    mountOk,
    mountDetail,
  );

  // Rule 8: the token never travels as a build argument or an image environment
  // value, because both end up in the image history.
  const leaked = allInstructions.filter(
    (line) => /^(ARG|ENV)\s/i.test(line) && line.includes(TOKEN_VARIABLE),
  );
  rule(
    `no ARG or ENV names ${TOKEN_VARIABLE}`,
    leaked.length === 0,
    leaked.join("; "),
  );

  return results.map((result) => ({ ...result, relative }));
}

const root = parseRoot();
const files = findDockerfiles(path.join(root, "apps"));
let failed = false;

if (files.length === 0) {
  console.log("[PASS] no Dockerfiles found under apps");
}

for (const file of files) {
  for (const result of checkFile(file, root)) {
    if (result.ok) {
      console.log(`[PASS] ${result.relative}: ${result.name}`);
    } else {
      failed = true;
      const detail = result.detail ? ` (${result.detail})` : "";
      console.error(`[FAIL] ${result.relative}: ${result.name}${detail}`);
    }
  }
}

process.exit(failed ? 1 : 0);
