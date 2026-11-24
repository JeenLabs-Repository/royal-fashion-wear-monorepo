import { createHmac } from "node:crypto";
import type {
  ConfigModule,
  IAuthModuleService,
  IUserModuleService,
  MedusaContainer,
} from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

const base64Url = (value: string | Buffer) =>
  Buffer.from(value).toString("base64url");

// An HS256 token carrying the claims the admin authentication middleware reads.
// Written out with node:crypto so the tests need no extra package.
const signToken = (payload: Record<string, unknown>, secret: string) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(
    JSON.stringify({ ...payload, iat: issuedAt, exp: issuedAt + 60 * 60 })
  );
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
};

// Creates an admin user with an emailpass identity and returns request headers
// that authenticate as that user. Pass the container of the running test app.
export const createAdminUser = async (
  container: MedusaContainer,
  email = "admin-test@example.test"
) => {
  const userModule = container.resolve<IUserModuleService>(Modules.USER);
  const authModule = container.resolve<IAuthModuleService>(Modules.AUTH);
  const config = container.resolve<ConfigModule>(
    ContainerRegistrationKeys.CONFIG_MODULE
  );

  const secret = config.projectConfig.http.jwtSecret;
  if (typeof secret !== "string" || !secret) {
    throw new Error(
      "The test app has no string jwtSecret to sign an admin token with."
    );
  }

  const user = await userModule.createUsers({ email });
  const authIdentity = await authModule.createAuthIdentities({
    provider_identities: [{ provider: "emailpass", entity_id: email }],
    app_metadata: { user_id: user.id },
  });

  const token = signToken(
    {
      actor_id: user.id,
      actor_type: "user",
      auth_identity_id: authIdentity.id,
      app_metadata: { user_id: user.id },
    },
    secret
  );

  return { headers: { authorization: `Bearer ${token}` } };
};
