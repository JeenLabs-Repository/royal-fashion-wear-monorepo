import type { MatrixEntry } from "./types";

const entries: MatrixEntry[] = [
  { method: "GET", path: "/vendor/me", mfaExempt: true, onboardingRoute: true },
];

export default entries;
