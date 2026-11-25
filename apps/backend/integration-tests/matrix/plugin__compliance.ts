import type { MatrixEntry } from "./types";

// Placeholder for the routes a compliance plugin will mount under /vendor/compliance.
// It is skipped until real route files exist, and the runner fails if they do and
// this placeholder is still here.
const entries: MatrixEntry[] = [
  {
    method: "GET",
    path: "/vendor/compliance/*",
    plugin: true,
    reason: "No plugin installed: add real fixtures when a plugin registers vendor routes",
  },
];

export default entries;
