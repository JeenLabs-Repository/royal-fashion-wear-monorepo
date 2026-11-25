import type { MatrixEntry } from "./types";

// The invitation route needs no sign-in. A token that does not exist must be
// refused with the generic invitation error, never with a 401.
const entries: MatrixEntry[] = [
  {
    method: "POST",
    path: "/vendor/accept-invite",
    body: () => ({ token: "matrix-not-a-real-token-0000000000", password: "matrix-password-123" }),
    public: true,
  },
];

export default entries;
