export type MatrixVendor = {
  vendorId: string;
  userId: string;
  email: string;
  password: string;
  locationIds: string[];
  locationCodes: string[];
  // Headers of an authenticated session. Vendors A, B, C and I are enrolled,
  // vendor D is signed in but has not enrolled two-factor sign-in.
  headers: Record<string, string>;
};

export type MatrixContext = {
  vendors: {
    a: MatrixVendor; // active, two locations
    b: MatrixVendor; // active, one location
    c: MatrixVendor; // enrolled session obtained first, then suspended
    d: MatrixVendor; // active, not enrolled
    i: MatrixVendor; // invited, registered, enrolled
  };
  currentAgreementVersion: string;
};

// A file sent as multipart form data.
export type MatrixMultipart = {
  field: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
};

export type MatrixEntry = {
  // PUT is allowlisted only for /vendor/inventory (absolute stock replace, D-09).
  method: "GET" | "POST" | "DELETE" | "PUT";
  // The route path with :name for every dynamic segment, for example /vendor/me/locations.
  path: string;
  // Values of vendor A for each dynamic segment. Vendor B must not reach them.
  idParams?: Record<string, (context: MatrixContext) => string>;
  // A valid body for vendor A. Vendor B sends it too and must only affect itself.
  body?: (context: MatrixContext) => Record<string, unknown>;
  // A multipart body for routes that take a file. Extra keys sent by the
  // harness become text fields next to the file.
  multipart?: (context: MatrixContext) => Promise<MatrixMultipart>;
  query?: Record<string, string>;
  // The route works for a vendor that has not enrolled two-factor sign-in.
  mfaExempt?: boolean;
  // The route works for an invited vendor.
  onboardingRoute?: boolean;
  // The route needs no sign-in (the invitation route).
  public?: boolean;
  // A placeholder for routes a plugin will register. Skipped until a real route exists.
  plugin?: boolean;
  reason?: string;
};
