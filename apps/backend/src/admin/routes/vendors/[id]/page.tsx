import { Alert, Container, Heading, Text } from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { LocationsTable } from "../../../components/vendors/locations-table";
import { OnboardingStepsCard } from "../../../components/vendors/onboarding-steps-card";
import { PluginSectionsCard } from "../../../components/vendors/plugin-sections-card";
import { StatusBadge } from "../../../components/vendors/status-badge";
import { VendorActions } from "../../../components/vendors/vendor-actions";
import { ErrorState, LoadingState } from "../../../lib/page-states";
import { usePermissions } from "../../../lib/use-permissions";
import {
  type InviteState,
  errorMessage,
  formatDate,
  getVendor,
  getVendorSections,
  isForbidden,
  isNotFound,
  vendorKeys,
} from "../../../lib/vendors-api";

const INVITE_TEXT: Record<InviteState, string> = {
  pending: "Pending",
  expired: "Expired",
  used: "Used",
  none: "None",
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between gap-x-4">
    <Text size="small" leading="compact" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text size="small" leading="compact" className="text-right">
      {value}
    </Text>
  </div>
);

const VendorDetailPage = () => {
  const { id = "" } = useParams();
  const { canManageVendors } = usePermissions();

  // Display queries load on mount with no enabling condition.
  const vendorQuery = useQuery({
    queryKey: vendorKeys.detail(id),
    queryFn: () => getVendor(id),
    retry: false,
  });
  const sectionsQuery = useQuery({
    queryKey: vendorKeys.sections(id),
    queryFn: () => getVendorSections(id),
    retry: false,
  });

  if (vendorQuery.isLoading) {
    return <LoadingState label="Loading vendor" />;
  }

  if (vendorQuery.error && isForbidden(vendorQuery.error)) {
    return (
      <Container className="px-6 py-4" data-testid="vendors-no-access">
        <Text size="small" leading="compact" weight="plus">
          You do not have access to this vendor.
        </Text>
      </Container>
    );
  }

  if (vendorQuery.error && isNotFound(vendorQuery.error)) {
    return (
      <Container className="flex flex-col gap-y-2 px-6 py-4" data-testid="vendor-not-found">
        <Text size="small" leading="compact" weight="plus">
          Vendor not found.
        </Text>
        <Link to="/vendors" className="text-ui-fg-interactive">
          Back to vendors
        </Link>
      </Container>
    );
  }

  if (vendorQuery.error || !vendorQuery.data) {
    return (
      <div data-testid="vendors-error">
        <ErrorState
          message={errorMessage(vendorQuery.error)}
          onRetry={() => {
            const reload = vendorQuery.refetch;
            void reload();
          }}
        />
      </div>
    );
  }

  const vendor = vendorQuery.data.vendor;
  const user = vendor.user;

  return (
    <div className="flex flex-col gap-y-3" data-testid="vendor-detail">
      <Container className="flex flex-col gap-y-4 px-6 py-4">
        <Link to="/vendors" className="text-ui-fg-interactive txt-small-plus">
          Back to vendors
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-x-3">
            <Heading level="h1">{vendor.internal_name}</Heading>
            <StatusBadge status={vendor.status} />
          </div>
        </div>
        <VendorActions vendor={vendor} canManage={canManageVendors} />
      </Container>

      <Container className="flex flex-col gap-y-3 px-6 py-4">
        <Heading level="h2">Details</Heading>
        <Row label="Contact name" value={vendor.contact_name} />
        <Row label="Contact email" value={vendor.contact_email} />
        <Row label="Internal note (never shown to the vendor)" value={vendor.note ?? "None"} />
        <Row label="Created" value={formatDate(vendor.created_at)} />
        <Row label="Activated" value={formatDate(vendor.activated_at)} />
        {vendor.status === "suspended" && (
          <Row label="Suspension reason" value={vendor.suspend_reason ?? "None"} />
        )}
      </Container>

      <Container className="flex flex-col gap-y-3 px-6 py-4" data-testid="vendor-user-card">
        <Heading level="h2">User and invitation</Heading>
        {user ? (
          <>
            <Row label="Email" value={user.email} />
            <Row label="Registered" value={user.registered ? "Yes" : "No"} />
            <Row label="Invitation" value={INVITE_TEXT[user.invite_state]} />
            <Row label="Invitation expires" value={formatDate(user.invite_expires_at)} />
          </>
        ) : (
          <Alert variant="warning">This vendor has no user yet.</Alert>
        )}
      </Container>

      <OnboardingStepsCard steps={vendor.onboarding_steps} />
      <LocationsTable vendorId={vendor.id} locations={vendor.locations} canManage={canManageVendors} />
      <PluginSectionsCard sections={sectionsQuery.data?.sections ?? []} />
    </div>
  );
};

export default VendorDetailPage;
