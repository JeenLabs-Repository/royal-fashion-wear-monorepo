import type { IAuthModuleService, MedusaContainer } from "@medusajs/framework/types";
import { MedusaError, Modules } from "@medusajs/framework/utils";

// Every call into the Auth module for vendor identities is here. The actor
// mechanics decision record settles each call shape.

const authOf = (container: MedusaContainer): IAuthModuleService =>
  container.resolve(Modules.AUTH) as IAuthModuleService;

/**
 * Ids of every auth identity, for any provider and any actor type, that uses
 * this email address.
 */
export async function findIdentityIdsByEmail(
  container: MedusaContainer,
  email: string
): Promise<string[]> {
  const rows = await authOf(container).listProviderIdentities({
    entity_id: email.trim().toLowerCase(),
  });
  const ids = rows
    .map((row) => (row as { auth_identity_id?: string | null }).auth_identity_id)
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

/**
 * Creates an emailpass identity with a password and returns its id.
 */
export async function registerEmailpassIdentity(
  container: MedusaContainer,
  email: string,
  password: string
): Promise<string> {
  const result = await authOf(container).register("emailpass", {
    url: "",
    headers: {},
    query: {},
    protocol: "",
    body: { email, password },
  } as never);
  if (!result.success || !result.authIdentity) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      result.error ?? "The identity could not be created."
    );
  }
  return result.authIdentity.id;
}

export async function deleteAuthIdentity(
  container: MedusaContainer,
  authIdentityId: string
): Promise<void> {
  await authOf(container).deleteAuthIdentities([authIdentityId]);
}

/**
 * Links an identity to a vendor user as the `vendor` actor.
 */
export async function linkVendorActor(
  container: MedusaContainer,
  authIdentityId: string,
  vendorUserId: string
): Promise<void> {
  await authOf(container).updateAuthIdentities({
    id: authIdentityId,
    app_metadata: { vendor_id: vendorUserId },
  } as never);
}
