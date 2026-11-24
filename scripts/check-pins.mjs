#!/usr/bin/env node
// Guard: exact version pins and the Node floor.
// An upgrade changes the PINS lines and the manifests together, in one commit.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PINS = {
  medusa: "2.22.7",
  // @medusajs/ui is released on its own version line, not with the platform.
  medusaUi: "4.2.14",
  gorgo: "2.0.0",
  node: ">=22.23.4",
  nvmrc: "22.23.4",
  packageManager: "pnpm@12.18.0",
};

const GORGO_PACKAGE = "@gorgo/medusa-integration";
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const args = process.argv.slice(2);
const rootFlag = args.indexOf("--root");
const root =
  rootFlag !== -1 && args[rootFlag + 1]
    ? resolve(args[rootFlag + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");

const readText = (relativePath) => readFileSync(join(root, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(readText(relativePath));

const manifestPaths = () => {
  const paths = ["package.json"];
  const appsDir = join(root, "apps");
  if (existsSync(appsDir)) {
    for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
      const manifest = `apps/${entry.name}/package.json`;
      if (entry.isDirectory() && existsSync(join(root, manifest))) {
        paths.push(manifest);
      }
    }
  }
  return paths;
};

// Every declared version of a dependency, as { file, section, name, version }.
const declaredVersions = (manifests) => {
  const found = [];
  for (const [file, json] of manifests) {
    for (const section of DEPENDENCY_SECTIONS) {
      for (const [name, version] of Object.entries(json[section] ?? {})) {
        found.push({ file, section, name, version });
      }
    }
    for (const [name, version] of Object.entries(json.pnpm?.overrides ?? {})) {
      found.push({ file, section: "pnpm.overrides", name, version });
    }
  }
  return found;
};

const findFiles = (dir, isWanted) => {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findFiles(full, isWanted));
    } else if (isWanted(entry.name, full)) {
      found.push(full);
    }
  }
  return found;
};

const isDockerfileName = (name) => name === "Dockerfile" || name.startsWith("Dockerfile.");
const findDockerfiles = (dir) => findFiles(dir, isDockerfileName);

// Files that can name a Postgres image: Dockerfiles, compose files and workflows.
const isComposeName = (name) => /^(docker-)?compose.*\.ya?ml$/.test(name);
const isWorkflowPath = (name, full) => /\.ya?ml$/.test(name) && /[\\/]\.github[\\/]workflows[\\/]/.test(full);
const findPostgresFiles = (dir) =>
  findFiles(dir, (name, full) => isDockerfileName(name) || isComposeName(name) || isWorkflowPath(name, full));

// Accepted Postgres tags: a numeric major (17, 17.2, 17-alpine) or the single named
// variable with a numeric fallback. The numeric fallback is the documented default
// until the owner reports the real major from the database host. Never latest.
const POSTGRES_TAG_OK = [
  /^\d+(\.\d+)*(-[0-9A-Za-z.]+)?$/,
  /^\$\{POSTGRES_VERSION:-\d+\}(-[0-9A-Za-z.]+)?$/,
  /^\$\{\{\s*vars\.POSTGRES_VERSION\s*\|\|\s*'\d+'\s*\}\}(-[0-9A-Za-z.]+)?$/,
];

// Returns null when the reference is acceptable, otherwise the reason it is not.
const postgresTagProblem = (reference) => {
  if (!reference.includes(":")) return "has no tag, use the numeric major";
  const tag = reference.slice(reference.indexOf(":") + 1);
  if (/latest/i.test(tag)) return "uses the floating latest tag";
  return POSTGRES_TAG_OK.some((pattern) => pattern.test(tag))
    ? null
    : `tag "${tag}" is not a numeric major or POSTGRES_VERSION with a numeric fallback`;
};

// Every postgres image reference in one file, as { line, reference }.
const postgresReferences = (text, isDockerfile) => {
  const found = [];
  text.split("\n").forEach((line, index) => {
    const match = isDockerfile
      ? line.match(/^FROM\s+(?:--platform=\S+\s+)?(postgres(?::\S*)?)(?:\s|$)/i)
      : line.match(/^\s*(?:-\s*)?image:\s*["']?(postgres(?::.*?)?)["']?\s*(?:\s#.*)?$/);
    if (match) found.push({ line: index + 1, reference: match[1].trim() });
  });
  return found;
};

const POSTGRES_CASES = [
  ["postgres:17-alpine", true],
  ["postgres:17", true],
  ["postgres:17.2-alpine", true],
  ["postgres:${POSTGRES_VERSION:-17}-alpine", true],
  ["postgres:${{ vars.POSTGRES_VERSION || '17' }}", true],
  ["postgres:latest", false],
  ["postgres:latest-alpine", false],
  ["postgres", false],
  ["postgres:alpine", false],
  ["postgres:${POSTGRES_VERSION:-latest}-alpine", false],
  ["postgres:${POSTGRES_VERSION}-alpine", false],
  ["postgres:${{ vars.POSTGRES_VERSION || 'latest' }}", false],
];

const postgresCaseFailures = () =>
  POSTGRES_CASES.filter(([reference, shouldPass]) => (postgresTagProblem(reference) === null) !== shouldPass).map(
    ([reference]) => reference,
  );

if (args.includes("--self-test")) {
  let broken = false;
  for (const [reference, shouldPass] of POSTGRES_CASES) {
    const ok = (postgresTagProblem(reference) === null) === shouldPass;
    broken = broken || !ok;
    console.log(`${ok ? "[PASS]" : "[FAIL]"} ${shouldPass ? "accepts" : "rejects"} ${reference}`);
  }
  process.exit(broken ? 1 : 0);
}

// The text of one importer block in pnpm-lock.yaml (two-space indented key).
const importerBlock = (lockfile, importer) => {
  const lines = lockfile.split("\n");
  const start = lines.indexOf(`  ${importer}:`);
  if (start === -1) return "";
  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {0,2}\S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join("\n");
};

const results = [];
const notes = {};
const check = (name, run) => {
  let problems;
  try {
    problems = run();
  } catch (error) {
    problems = [`could not run: ${error.message}`];
  }
  results.push({ name, problems });
};

const manifests = manifestPaths().map((file) => [file, readJson(file)]);

check("medusa-pins", () => {
  const problems = [];
  for (const { file, section, name, version } of declaredVersions(manifests)) {
    if (!name.startsWith("@medusajs/")) continue;
    const expected = name === "@medusajs/ui" ? PINS.medusaUi : PINS.medusa;
    if (!EXACT_VERSION.test(version)) {
      problems.push(`${file} ${section} ${name} is "${version}", not an exact version`);
    } else if (version !== expected) {
      problems.push(`${file} ${section} ${name} is ${version}, expected ${expected}`);
    }
  }
  return problems;
});

check("gorgo-pin", () => {
  const problems = [];
  let seen = 0;
  for (const { file, section, name, version } of declaredVersions(manifests)) {
    if (name !== GORGO_PACKAGE) continue;
    seen += 1;
    if (version !== PINS.gorgo) {
      problems.push(`${file} ${section} ${name} is "${version}", expected ${PINS.gorgo}`);
    }
  }
  if (seen === 0) problems.push(`${GORGO_PACKAGE} is not declared anywhere`);
  return problems;
});

check("node-engines", () => {
  const problems = [];
  const required = ["package.json", "apps/backend/package.json", "apps/storefront/package.json"];
  for (const file of required) {
    const manifest = manifests.find(([path]) => path === file);
    if (!manifest) {
      problems.push(`${file} is missing`);
    } else if (manifest[1].engines?.node !== PINS.node) {
      problems.push(`${file} engines.node is "${manifest[1].engines?.node}", expected "${PINS.node}"`);
    }
  }
  return problems;
});

check("nvmrc", () => {
  const first = readText(".nvmrc").split("\n")[0].trim();
  return first === PINS.nvmrc ? [] : [`.nvmrc starts with "${first}", expected ${PINS.nvmrc}`];
});

check("package-manager", () => {
  const value = manifests[0][1].packageManager;
  return value === PINS.packageManager
    ? []
    : [`package.json packageManager is "${value}", expected ${PINS.packageManager}`];
});

check("workflow-node-version", () => {
  const problems = [];
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return problems;
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const text = readFileSync(join(dir, name), "utf8");
    if (!text.includes("actions/setup-node")) continue;
    if (!/^\s*node-version-file:\s*\.nvmrc\s*$/m.test(text)) {
      problems.push(`${name} uses setup-node without "node-version-file: .nvmrc"`);
    }
    if (/^\s*(-\s*)?node-version:/m.test(text)) {
      problems.push(`${name} sets a literal node-version`);
    }
  }
  return problems;
});

check("dockerfile-node-tags", () => {
  const problems = [];
  const dockerfiles = findDockerfiles(root);
  notes["dockerfile-node-tags"] = `${dockerfiles.length} Dockerfiles inspected`;
  for (const file of dockerfiles) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const match = line.match(/^FROM\s+(?:--platform=\S+\s+)?node:(\S+)/i);
      if (match && !match[1].startsWith(PINS.nvmrc)) {
        const shown = file.slice(root.length + 1);
        problems.push(`${shown}:${index + 1} uses node:${match[1]}, expected node:${PINS.nvmrc}*`);
      }
    });
  }
  return problems;
});

check("postgres-image-tags", () => {
  const problems = postgresCaseFailures().map((reference) => `classifier case is wrong for ${reference}`);
  const files = findPostgresFiles(root);
  let references = 0;
  for (const file of files) {
    const shown = file.slice(root.length + 1);
    const found = postgresReferences(readFileSync(file, "utf8"), isDockerfileName(file.split(/[\\/]/).pop()));
    references += found.length;
    for (const { line, reference } of found) {
      const problem = postgresTagProblem(reference);
      if (problem) problems.push(`${shown}:${line} ${reference} ${problem}`);
    }
  }
  notes["postgres-image-tags"] = `${references} postgres images in ${files.length} files inspected`;
  return problems;
});

check("lockfile-gorgo", () => {
  const block = importerBlock(readText("pnpm-lock.yaml"), "apps/backend");
  const match = block.match(/^ {6}'@gorgo\/medusa-integration':\n {8}specifier: (\S+)/m);
  if (!match) return ["pnpm-lock.yaml has no apps/backend entry for the integration module"];
  return match[1] === PINS.gorgo
    ? []
    : [`pnpm-lock.yaml specifier is ${match[1]}, expected ${PINS.gorgo}`];
});

let failed = false;
for (const { name, problems } of results) {
  if (problems.length === 0) {
    console.log(notes[name] ? `[PASS] ${name} (${notes[name]})` : `[PASS] ${name}`);
  } else {
    failed = true;
    for (const problem of problems) console.log(`[FAIL] ${name}: ${problem}`);
  }
}
process.exit(failed ? 1 : 0);
