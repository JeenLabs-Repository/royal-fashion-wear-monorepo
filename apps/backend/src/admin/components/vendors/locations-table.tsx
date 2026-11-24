import { Badge, Button, Container, Heading, Table, Text } from "@medusajs/ui";
import { useState } from "react";
import type { VendorLocation } from "../../lib/vendors-api";
import { LocationCreateModal, LocationEditDrawer } from "./location-drawer";

type Props = { vendorId: string; locations: VendorLocation[]; canManage: boolean };

export const LocationsTable = ({ vendorId, locations, canManage }: Props) => {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<VendorLocation | null>(null);

  return (
    <Container className="divide-y p-0" data-testid="locations-table">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Locations</Heading>
        <Button
          size="small"
          variant="secondary"
          disabled={!canManage}
          title={canManage ? undefined : "Your role cannot change vendors."}
          onClick={() => setCreateOpen(true)}
          data-testid="add-location-button"
        >
          Add location
        </Button>
      </div>

      {locations.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            This vendor has no locations yet.
          </Text>
        </div>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Code</Table.HeaderCell>
              <Table.HeaderCell>Label</Table.HeaderCell>
              <Table.HeaderCell>State</Table.HeaderCell>
              <Table.HeaderCell>PIN</Table.HeaderCell>
              <Table.HeaderCell>Pickup contact</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {locations.map((location) => (
              <Table.Row key={location.id} data-testid={`location-row-${location.code}`}>
                <Table.Cell>{location.code}</Table.Cell>
                <Table.Cell>{location.label}</Table.Cell>
                <Table.Cell>{location.state_name}</Table.Cell>
                <Table.Cell>{location.pin}</Table.Cell>
                <Table.Cell>
                  {location.pickup_contact_name} {location.pickup_contact_phone}
                </Table.Cell>
                <Table.Cell>
                  <Badge size="2xsmall" color={location.status === "active" ? "green" : "grey"}>
                    {location.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={!canManage}
                    title={canManage ? undefined : "Your role cannot change vendors."}
                    onClick={() => setEditing(location)}
                    data-testid={`edit-location-${location.code}`}
                  >
                    Edit
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      <LocationCreateModal vendorId={vendorId} open={createOpen} onOpenChange={setCreateOpen} />
      <LocationEditDrawer
        vendorId={vendorId}
        location={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </Container>
  );
};
