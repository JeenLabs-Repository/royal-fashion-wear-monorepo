const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const source = path.join(projectRoot, "src", "modules", "vendor", "agreements");
const destination = path.join(
  projectRoot,
  ".medusa",
  "server",
  "src",
  "modules",
  "vendor",
  "agreements",
);

if (!fs.existsSync(path.dirname(destination))) {
  throw new Error(
    `"${path.dirname(destination)}" does not exist. Run "medusa build" before copying the agreement files.`,
  );
}

// Only the Markdown documents: the compiled loader already sits in the destination.
fs.cpSync(source, destination, {
  recursive: true,
  filter: (src) => {
    if (fs.statSync(src).isDirectory()) {
      return path.basename(src) !== "__tests__";
    }
    return src.endsWith(".md");
  },
});
