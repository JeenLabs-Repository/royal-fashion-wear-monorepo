export type SurfaceKind =
  | "store-api"
  | "storefront-html"
  | "storefront-rsc"
  | "storefront-json-ld"
  | "sitemap"
  | "llms-txt"
  | "image"
  | "email"
  | "pdf"
  | "tracking"
  | "plugin-placeholder";

export type CanaryManifest = {
  publishable_key: string;
  generated_at: string;
  vendors: Record<
    string,
    {
      vendor_id: string;
      user_id: string;
      email: string;
      password: string;
      status: string;
      location_codes: string[];
      totp_secret?: string;
    }
  >;
  // Written by the canary seed for catalog surfaces that approve products.
  approver?: {
    id: string;
    email: string;
    password: string;
    identityId: string;
    roleKeys: string[];
    isBreakGlass: boolean;
    mfaEnrolled: boolean;
    tokenSecret: string;
  };
};

export type SurfaceContext = {
  backendUrl: string;
  storefrontUrl: string;
  locale: string;
  manifest: CanaryManifest;
  manifestPath: string;
};

export type SurfaceResponse = {
  url: string;
  status: number;
  contentType: string;
  body: string | Buffer;
};

export type Surface = {
  id: string;
  kind: SurfaceKind;
  owner: string;
  description: string;
  minRequests: number;
  collect: (context: SurfaceContext) => Promise<SurfaceResponse[]>;
};

const surfaces = new Map<string, Surface>();
const exercised = new Map<string, number>();

export const registerSurface = (surface: Surface): void => {
  if (typeof surface.id !== "string" || surface.id.trim() === "") {
    throw new Error("A canary surface needs a non-empty id.");
  }
  if (surfaces.has(surface.id)) {
    throw new Error(`Canary surface "${surface.id}" is already registered.`);
  }
  if (!Number.isInteger(surface.minRequests) || surface.minRequests < 1) {
    throw new Error(`Canary surface "${surface.id}" needs minRequests of at least 1.`);
  }
  surfaces.set(surface.id, surface);
};

export const listSurfaces = (): Surface[] => [...surfaces.values()];

export const markExercised = (id: string, requests: number): void => {
  exercised.set(id, (exercised.get(id) ?? 0) + requests);
};

export const exercisedReport = (): {
  id: string;
  kind: SurfaceKind;
  minRequests: number;
  requests: number;
  satisfied: boolean;
}[] =>
  listSurfaces().map((surface) => {
    const requests = exercised.get(surface.id) ?? 0;
    return {
      id: surface.id,
      kind: surface.kind,
      minRequests: surface.minRequests,
      requests,
      satisfied: requests >= surface.minRequests,
    };
  });

export const assertAllExercised = (): void => {
  const missing = exercisedReport().filter((row) => !row.satisfied);
  if (missing.length > 0) {
    const lines = missing.map(
      (row) => `- ${row.id}: ${row.requests} request(s), at least ${row.minRequests} required`
    );
    throw new Error(
      `These canary surfaces were not exercised enough:\n${lines.join("\n")}\nAn unexercised or empty surface fails the suite.`
    );
  }
};

export const clearRegistry = (): void => {
  surfaces.clear();
  exercised.clear();
};
