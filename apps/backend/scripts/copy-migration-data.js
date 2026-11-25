const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const source = path.join(projectRoot, "src", "migration-scripts", "data");
const destination = path.join(
  projectRoot,
  ".medusa",
  "server",
  "src",
  "migration-scripts",
  "data",
);

if (!fs.existsSync(destination)) {
  throw new Error(
    `"${destination}" does not exist. Run "medusa build" before copying migration data.`,
  );
}

fs.cpSync(source, destination, {
  recursive: true,
  filter: (src) => fs.statSync(src).isDirectory() || src.endsWith(".json"),
});

// Single data files the compiled server reads next to its own modules.
const bundledFiles = [
  path.join("src", "lib", "geo-india", "pincode-directory.json"),
];

for (const relative of bundledFiles) {
  const from = path.join(projectRoot, relative);
  const to = path.join(projectRoot, ".medusa", "server", relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
