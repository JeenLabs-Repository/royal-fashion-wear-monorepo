import type { MatrixEntry } from "./types";

// The new password equals the current one, so running the matrix leaves the
// fixture vendors' credentials unchanged.
const entries: MatrixEntry[] = [
  {
    method: "POST",
    path: "/vendor/me/password",
    onboardingRoute: true,
    body: (ctx) => ({
      current_password: ctx.vendors.a.password,
      new_password: ctx.vendors.a.password,
    }),
  },
];

export default entries;
