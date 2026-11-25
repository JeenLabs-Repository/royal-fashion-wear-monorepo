import { Badge, Button, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { getLocations, portalKeys } from "../lib/api"
import { errorText } from "../lib/errors"

export const Locations = () => {
  const locations = useQuery({
    queryKey: portalKeys.locations,
    queryFn: getLocations,
    retry: false,
  })
  const rows = locations.data?.locations ?? []

  return (
    <div className="flex flex-col gap-y-4" data-testid="screen-locations">
      <Heading level="h1">Locations</Heading>
      <Text className="text-ui-fg-subtle" data-testid="locations-note">
        Locations are managed by the store. To change one, contact the store team.
      </Text>

      {locations.isLoading && (
        <span
          role="status"
          aria-label="Loading"
          className="size-5 animate-spin rounded-full border-2 border-ui-border-strong border-t-ui-fg-base"
        />
      )}

      {locations.isError && (
        <div className="flex flex-col items-start gap-y-2" role="alert">
          <Text className="text-ui-fg-error">{errorText(locations.error)}</Text>
          <Button size="small" variant="secondary" onClick={() => void locations.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {locations.data && rows.length === 0 && (
        <Text data-testid="locations-empty">
          No locations yet. The store team adds your pickup locations.
        </Text>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md bg-ui-bg-base shadow-elevation-card-rest">
          <table className="w-full min-w-[40rem] text-left txt-small" data-testid="locations-table">
            <thead className="border-b border-ui-border-base text-ui-fg-subtle">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">PIN</th>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Pickup contact</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((location) => (
                <tr
                  key={location.id}
                  className="border-b border-ui-border-base last:border-0"
                  data-testid={`location-row-${location.code}`}
                >
                  <td className="px-3 py-2">{location.code}</td>
                  <td className="px-3 py-2">{location.label}</td>
                  <td className="px-3 py-2">{location.state_name}</td>
                  <td className="px-3 py-2">{location.pin}</td>
                  <td className="px-3 py-2">
                    {[location.address_1, location.address_2, location.city]
                      .filter(Boolean)
                      .join(", ")}
                  </td>
                  <td className="px-3 py-2">
                    {location.pickup_contact_name} {location.pickup_contact_phone}
                  </td>
                  <td className="px-3 py-2">
                    <Badge size="2xsmall" color={location.status === "active" ? "green" : "grey"}>
                      {location.status === "active" ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
