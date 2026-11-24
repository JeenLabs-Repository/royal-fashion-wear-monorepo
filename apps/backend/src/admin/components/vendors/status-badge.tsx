import { Badge } from "@medusajs/ui";
import type { VendorStatus } from "../../lib/vendors-api";

const COLORS: Record<VendorStatus, "grey" | "green" | "red"> = {
  invited: "grey",
  active: "green",
  suspended: "red",
};

const LABELS: Record<VendorStatus, string> = {
  invited: "Invited",
  active: "Active",
  suspended: "Suspended",
};

export const StatusBadge = ({ status }: { status: VendorStatus }) => (
  <Badge size="2xsmall" color={COLORS[status]} data-testid="vendor-status-badge">
    {LABELS[status]}
  </Badge>
);
