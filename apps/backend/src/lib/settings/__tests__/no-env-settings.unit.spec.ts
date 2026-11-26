import fs from "node:fs";
import path from "node:path";

const BACKEND_ROOT = path.resolve(__dirname, "../../../..");
const REPO_ROOT = path.resolve(BACKEND_ROOT, "../..");

// Folders of application code that sit between a card and the outside world.
const APP_FOLDERS = [
  "src/modules",
  "src/providers",
  "src/lib/payments",
  "src/lib/settings",
];

// The development mail fallback is the one allowed reader of mail variables, and
// only because it refuses to run in production.
const ALLOWED_FILES = ["src/lib/settings/smtp-dev-fallback.ts"];

// The runtime mode is not a setting that has a card.
const ALLOWED_NAMES = new Set(["NODE_ENV"]);

type SourceFile = { file: string; source: string };

const READ_PATTERN =
  /process\.env(?:\s*\.\s*([A-Za-z_$][\w$]*)|\s*\[\s*(["'`])([^"'`]*)\2\s*\]|(\s*\[)|)/g;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Names read from the environment. A bare reference or a computed key counts as "*"
// because either one can read any variable.
function envReads(source: string): string[] {
  const names: string[] = [];
  const text = stripComments(source);
  for (const match of text.matchAll(READ_PATTERN)) {
    names.push(match[1] ?? match[3] ?? "*");
  }
  return names;
}

function findViolations(
  files: SourceFile[],
  allowedFiles: string[] = []
): string[] {
  const violations: string[] = [];
  for (const { file, source } of files) {
    if (allowedFiles.includes(file)) continue;
    for (const name of envReads(source)) {
      if (!ALLOWED_NAMES.has(name)) violations.push(`${file} reads ${name}`);
    }
  }
  return violations;
}

function walk(root: string, extensions: string[], base = root): SourceFile[] {
  if (!fs.existsSync(root)) return [];
  const out: SourceFile[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, extensions, base));
    else if (
      extensions.some((ext) => entry.name.endsWith(ext)) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push({
        file: path.relative(base, full).split(path.sep).join("/"),
        source: fs.readFileSync(full, "utf8"),
      });
    }
  }
  return out;
}

function appFiles(): SourceFile[] {
  return APP_FOLDERS.flatMap((folder) =>
    walk(path.join(BACKEND_ROOT, folder), [".ts", ".tsx"], BACKEND_ROOT)
  );
}

function pluginBuilds(): { name: string; files: SourceFile[] }[] {
  const registry = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "config/plugin-registry.json"), "utf8")
  ) as {
    repos: Record<string, { package: string; planned?: boolean }>;
  };
  return Object.values(registry.repos)
    .filter((repo) => !repo.planned)
    .map((repo) => {
      const root = path.join(
        BACKEND_ROOT,
        "node_modules",
        repo.package,
        ".medusa/server"
      );
      return { name: repo.package, files: walk(root, [".js"]) };
    });
}

describe("settings with a card are never read from the environment", () => {
  it("flags a provider file that reads another variable", () => {
    const violations = findViolations([
      {
        file: "src/providers/example/index.ts",
        source: "const host = process.env.SMTP_HOST;",
      },
    ]);
    expect(violations).toEqual([
      "src/providers/example/index.ts reads SMTP_HOST",
    ]);
  });

  it("flags the same read in a plugin build file", () => {
    const violations = findViolations([
      {
        file: "providers/razorpay/index.js",
        source: "const k = process.env.RAZORPAY_KEY_SECRET;",
      },
    ]);
    expect(violations).toEqual([
      "providers/razorpay/index.js reads RAZORPAY_KEY_SECRET",
    ]);
  });

  it("allows the runtime mode", () => {
    expect(
      findViolations([
        { file: "a.ts", source: 'if (process.env.NODE_ENV === "production") {}' },
      ])
    ).toEqual([]);
    expect(
      findViolations([{ file: "a.ts", source: 'process.env["NODE_ENV"]' }])
    ).toEqual([]);
  });

  it("flags a quoted key other than the runtime mode", () => {
    expect(
      findViolations([{ file: "a.ts", source: 'process.env["STRIPE_KEY"]' }])
    ).toEqual(["a.ts reads STRIPE_KEY"]);
  });

  it("flags bare and computed reads because they can read any variable", () => {
    expect(
      findViolations([{ file: "a.ts", source: "const all = { ...process.env };" }])
    ).toEqual(["a.ts reads *"]);
    expect(
      findViolations([{ file: "a.ts", source: "const v = process.env[name];" }])
    ).toEqual(["a.ts reads *"]);
  });

  it("ignores mentions inside comments", () => {
    const source =
      "// never read process.env.SMTP_HOST here\n/* process.env.OTHER */\nexport const x = 1;";
    expect(findViolations([{ file: "a.ts", source }])).toEqual([]);
  });

  it("skips only the exact allowlisted file path", () => {
    const source = "const h = process.env.SMTP_HOST;";
    const allowed = ALLOWED_FILES[0];
    expect(findViolations([{ file: allowed, source }], ALLOWED_FILES)).toEqual(
      []
    );
    expect(
      findViolations([{ file: `${allowed}.bak`, source }], ALLOWED_FILES)
    ).toHaveLength(1);
    expect(
      findViolations(
        [{ file: "src/lib/settings/smtp.ts", source }],
        ALLOWED_FILES
      )
    ).toHaveLength(1);
  });

  it("finds no environment read in the application provider and settings folders", () => {
    const files = appFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(findViolations(files, ALLOWED_FILES)).toEqual([]);
  });

  it("finds only the runtime mode in the installed plugin builds", () => {
    const builds = pluginBuilds();
    for (const build of builds) {
      // A plugin that is not installed would make this test pass for the wrong reason.
      expect({ name: build.name, scanned: build.files.length > 0 }).toEqual({
        name: build.name,
        scanned: true,
      });
      expect(findViolations(build.files)).toEqual([]);
    }
    expect(builds.length).toBeGreaterThanOrEqual(2);
  });
});
