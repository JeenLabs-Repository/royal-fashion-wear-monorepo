import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Alert, Button, Container, Heading, Input, Select, Table, Text } from "@medusajs/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { InviteVendorModal } from "../../components/vendors/invite-vendor-modal";
import { StateCoverageStrip } from "../../components/vendors/state-coverage-strip";
import { StatusBadge } from "../../components/vendors/status-badge";
import { EmptyState, ErrorState, LoadingState } from "../../lib/page-states";
import { usePermissions } from "../../lib/use-permissions";
import {
  type VendorStatus,
  errorMessage,
  formatDate,
  getStateCoverage,
  isForbidden,
  listVendors,
  locationCount,
  vendorKeys,
} from "../../lib/vendors-api";

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const STATUS_OPTIONS: { value: "all" | VendorStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "invited", label: "Invited" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];

const VendorsPage = () => {
  const { canManageVendors, isLoading: permissionsLoading } = usePermissions();
  const [status, setStatus] = useState<"all" | VendorStatus>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const params = {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(status !== "all" ? { status } : {}),
    ...(search ? { q: search } : {}),
  };

  // Display queries load on mount with no enabling condition.
  const list = useQuery({
    queryKey: vendorKeys.list(params),
    queryFn: () => listVendors(params),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const coverage = useQuery({
    queryKey: vendorKeys.coverage,
    queryFn: getStateCoverage,
    retry: false,
  });

  if (list.error && isForbidden(list.error)) {
    return (
      <Container className="flex flex-col gap-y-1 px-6 py-4" data-testid="vendors-no-access">
        <Text size="small" leading="compact" weight="plus">
          You do not have access to vendors.
        </Text>
      </Container>
    );
  }

  const vendors = list.data?.vendors ?? [];
  const count = list.data?.count ?? 0;
  const draftAgreement = list.data?.warnings?.includes("agreement_is_draft") ?? false;
  const filtered = status !== "all" || search !== "";
  const lastPage = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1);

  return (
    <div className="flex flex-col gap-y-3" data-testid="vendors-page">
      {draftAgreement && (
        <div data-testid="agreement-draft-callout">
          <Alert variant="warning">
            The agreement shown to vendors is still a draft placeholder. Replace it before inviting
            real vendors.
          </Alert>
        </div>
      )}

      <StateCoverageStrip
        states={coverage.data?.states}
        isLoading={coverage.isLoading}
        isError={coverage.isError}
      />

      <Container className="divide-y p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <Heading level="h1">Vendors</Heading>
          <Button
            size="small"
            onClick={() => setInviteOpen(true)}
            disabled={!canManageVendors || permissionsLoading}
            title={canManageVendors ? undefined : "Your role cannot invite vendors."}
            data-testid="invite-vendor-button"
          >
            Invite vendor
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          <div className="w-44" data-testid="vendors-status-filter">
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value as "all" | VendorStatus);
                setPage(0);
              }}
            >
              <Select.Trigger aria-label="Status filter">
                <Select.Value placeholder="Status" />
              </Select.Trigger>
              <Select.Content>
                {STATUS_OPTIONS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div className="w-64">
            <Input
              type="search"
              placeholder="Search by internal name"
              aria-label="Search by internal name"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              data-testid="vendors-search"
            />
          </div>
        </div>

        {list.isLoading && <LoadingState label="Loading vendors" />}

        {list.isError && !isForbidden(list.error) && (
          <div data-testid="vendors-error">
            <ErrorState
              message={errorMessage(list.error)}
              onRetry={() => {
                const reload = list.refetch;
                void reload();
              }}
            />
          </div>
        )}

        {!list.isLoading && !list.isError && vendors.length === 0 && (
          <div data-testid="vendors-empty">
            <EmptyState
              message={
                filtered
                  ? "No vendors match your filters."
                  : "No vendors yet. Invite your first vendor."
              }
            />
          </div>
        )}

        {vendors.length > 0 && (
          <Table data-testid="vendors-table">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Internal name</Table.HeaderCell>
                <Table.HeaderCell>Contact email</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Locations</Table.HeaderCell>
                <Table.HeaderCell>Activated</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {vendors.map((vendor) => (
                <Table.Row key={vendor.id} data-testid={`vendor-row-${vendor.id}`}>
                  <Table.Cell>
                    <Link
                      to={`/vendors/${vendor.id}`}
                      className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                    >
                      {vendor.internal_name}
                    </Link>
                  </Table.Cell>
                  <Table.Cell>{vendor.contact_email}</Table.Cell>
                  <Table.Cell>
                    <StatusBadge status={vendor.status} />
                  </Table.Cell>
                  <Table.Cell>{locationCount(vendor)}</Table.Cell>
                  <Table.Cell>{formatDate(vendor.activated_at)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}

        {count > PAGE_SIZE && (
          <div className="flex items-center justify-between px-6 py-4">
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Page {page + 1} of {lastPage + 1}
            </Text>
            <div className="flex gap-x-2">
              <Button
                size="small"
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                Previous
              </Button>
              <Button
                size="small"
                variant="secondary"
                disabled={page >= lastPage}
                onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Container>

      <InviteVendorModal open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Vendors",
});

export default VendorsPage;
