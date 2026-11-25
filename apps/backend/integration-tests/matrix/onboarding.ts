import type { MatrixEntry } from "./types";

const entries: MatrixEntry[] = [
  { method: "GET", path: "/vendor/onboarding", mfaExempt: true, onboardingRoute: true },
];

export default entries;
