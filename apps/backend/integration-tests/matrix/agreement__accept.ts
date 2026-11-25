import type { MatrixEntry } from "./types";

const entries: MatrixEntry[] = [
  {
    method: "POST",
    path: "/vendor/agreement/accept",
    body: (context) => ({ version: context.currentAgreementVersion, accepted: true }),
    onboardingRoute: true,
  },
];

export default entries;
