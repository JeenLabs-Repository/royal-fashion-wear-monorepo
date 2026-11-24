import { useQuery } from "@tanstack/react-query";
import { fetchMe, staffKeys } from "./staff-api";

export const VENDORS_MANAGE = "vendors:manage";

// The buttons that call this are a convenience. The API refuses a role without
// the permission on its own, and the screens show that refusal.
export const usePermissions = () => {
  const me = useQuery({ queryKey: staffKeys.me, queryFn: fetchMe, retry: false });
  const permissions = me.data?.permissions ?? [];

  return {
    // Stays false while loading, so buttons are disabled until the answer is in.
    canManageVendors: permissions.includes(VENDORS_MANAGE),
    isLoading: me.isLoading,
  };
};
