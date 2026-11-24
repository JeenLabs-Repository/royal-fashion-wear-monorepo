import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Alert } from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchMe, fetchOpenReviews, staffKeys } from "../lib/staff-api";

// Shows to superadmins only while a review is open. Everyone else, and every
// loading or error state, renders nothing.
const BreakGlassBanner = () => {
  const me = useQuery({ queryKey: staffKeys.me, queryFn: fetchMe, retry: false });
  const canManage = Boolean(me.data?.permissions.includes("staff:manage"));

  const reviews = useQuery({
    queryKey: staffKeys.openReviews,
    queryFn: fetchOpenReviews,
    enabled: canManage,
    retry: false,
  });

  if (!canManage || reviews.isLoading || reviews.error) {
    return null;
  }
  if ((reviews.data?.reviews.length ?? 0) === 0) {
    return null;
  }

  return (
    <Alert variant="warning" className="mb-3">
      The break-glass account was used. Review the access and rotate its credentials.{" "}
      <Link to="/staff" className="underline">
        Open Staff
      </Link>
    </Alert>
  );
};

export const config = defineWidgetConfig({
  zone: ["order.list.before", "product.list.before"],
});

export default BreakGlassBanner;
