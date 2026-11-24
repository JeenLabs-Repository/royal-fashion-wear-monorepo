import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Container,
  Drawer,
  Heading,
  Label,
  Select,
  Table,
  Text,
  Textarea,
  Tooltip,
  toast,
  usePrompt,
} from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoAccessState,
} from "../../lib/page-states";
import {
  type BreakGlassReview,
  ROLE_OPTIONS,
  type StaffRow,
  assignRole,
  closeReview,
  errorMessage,
  fetchMe,
  fetchOpenReviews,
  fetchStaff,
  isForbidden,
  revokeRole,
  roleLabel,
  staffKeys,
} from "../../lib/staff-api";

const NO_ACCESS_MESSAGE = "You do not have access to staff management. Ask a superadmin.";

const MFA_BADGES = {
  enrolled: { color: "green", text: "MFA enrolled" },
  not_enrolled: { color: "orange", text: "MFA not enrolled" },
  unknown: { color: "grey", text: "MFA unknown" },
} as const;

const StaffPage = () => {
  const queryClient = useQueryClient();
  const prompt = usePrompt();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roleToAdd, setRoleToAdd] = useState("");
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [closing, setClosing] = useState<BreakGlassReview | null>(null);
  const [rotated, setRotated] = useState(false);
  const [note, setNote] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);

  // Display queries load on mount with no enabling condition.
  const me = useQuery({ queryKey: staffKeys.me, queryFn: fetchMe, retry: false });
  const list = useQuery({ queryKey: staffKeys.list, queryFn: fetchStaff, retry: false });
  const reviews = useQuery({
    queryKey: staffKeys.openReviews,
    queryFn: fetchOpenReviews,
    retry: false,
  });

  useEffect(() => {
    if (list.error && !isForbidden(list.error)) {
      toast.error(errorMessage(list.error));
    }
  }, [list.error]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: staffKeys.list }),
      queryClient.invalidateQueries({ queryKey: staffKeys.me }),
      queryClient.invalidateQueries({ queryKey: staffKeys.openReviews }),
    ]);

  const assign = useMutation({
    mutationFn: (input: { userId: string; role: string }) =>
      assignRole(input.userId, input.role),
    onSuccess: async () => {
      setDrawerError(null);
      setRoleToAdd("");
      toast.success("Role assigned");
      await refresh();
    },
    onError: (error) => setDrawerError(errorMessage(error)),
  });

  const revoke = useMutation({
    mutationFn: (input: { userId: string; role: string }) =>
      revokeRole(input.userId, input.role),
    onSuccess: async () => {
      setDrawerError(null);
      toast.success("Role revoked");
      await refresh();
    },
    onError: (error) => setDrawerError(errorMessage(error)),
  });

  const close = useMutation({
    mutationFn: (input: { reviewId: string; note: string }) =>
      closeReview(input.reviewId, { rotated_confirmed: true, note: input.note }),
    onSuccess: async () => {
      setClosing(null);
      setRotated(false);
      setNote("");
      setCloseError(null);
      toast.success("Review closed");
      await refresh();
    },
    onError: (error) => setCloseError(errorMessage(error)),
  });

  const confirmRevoke = async (row: StaffRow, role: string) => {
    const confirmed = await prompt({
      title: "Revoke role",
      description: `Remove ${roleLabel(role)} from ${row.email}? The change applies on their next request.`,
      confirmText: "Revoke role",
      cancelText: "Cancel",
    });
    if (confirmed) {
      revoke.mutate({ userId: row.user_id, role });
    }
  };

  if (me.isLoading || list.isLoading) {
    return <LoadingState />;
  }

  if ((list.error && isForbidden(list.error)) || me.data?.access === "no_role") {
    return <NoAccessState message={NO_ACCESS_MESSAGE} />;
  }

  if (list.error) {
    return (
      <ErrorState
        message={errorMessage(list.error)}
        onRetry={() => {
          void list.refetch();
        }}
      />
    );
  }

  const staff = list.data?.staff ?? [];
  const selected = staff.find((row) => row.user_id === selectedId) ?? null;
  const openReviews = reviews.data?.reviews ?? [];
  const assignable = ROLE_OPTIONS.filter((role) => !selected?.roles.includes(role.key));

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Heading>Staff</Heading>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            New users get no access until a superadmin assigns a role.
          </Text>
        </div>
        <Button size="small" variant="secondary" asChild>
          <Link to="/settings/users">Invite staff</Link>
        </Button>
      </Container>

      {openReviews.length > 0 && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              Open break-glass reviews
            </Text>
          </div>
          {openReviews.map((review) => (
            <div key={review.id} className="flex items-center justify-between gap-x-3 px-6 py-3">
              <div className="flex flex-col gap-y-1">
                <Text size="small" leading="compact">
                  Opened {new Date(review.opened_at).toLocaleString()} from{" "}
                  {review.first_ip ?? "an unknown address"}
                </Text>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  First request {review.first_request ?? "unknown"}
                </Text>
              </div>
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  setClosing(review);
                  setCloseError(null);
                }}
              >
                Close review
              </Button>
            </div>
          ))}
        </Container>
      )}

      {staff.length === 0 ? (
        <EmptyState message="No staff accounts yet." />
      ) : (
        <Container className="p-0">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Email</Table.HeaderCell>
                <Table.HeaderCell>Name</Table.HeaderCell>
                <Table.HeaderCell>Roles</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {staff.map((row) => {
                const mfa = MFA_BADGES[row.mfa_state] ?? MFA_BADGES.unknown;
                return (
                  <Table.Row key={row.user_id}>
                    <Table.Cell>{row.email}</Table.Cell>
                    <Table.Cell>
                      {[row.first_name, row.last_name].filter(Boolean).join(" ") || "None"}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-wrap gap-1">
                        {row.roles.length === 0 ? (
                          <Text size="small" leading="compact" className="text-ui-fg-subtle">
                            No roles
                          </Text>
                        ) : (
                          row.roles.map((role) => (
                            <Badge
                              key={role}
                              size="2xsmall"
                              color={role === "superadmin" ? "purple" : "grey"}
                            >
                              {roleLabel(role)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-wrap gap-1">
                        <Badge size="2xsmall" color={mfa.color}>
                          {mfa.text}
                        </Badge>
                        {row.is_break_glass && (
                          <Badge size="2xsmall" color="red">
                            Break-glass
                          </Badge>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      {row.is_break_glass ? (
                        <Tooltip content="The break-glass account can only be changed from the server command line.">
                          <span>
                            <Button size="small" variant="secondary" disabled>
                              Manage roles
                            </Button>
                          </span>
                        </Tooltip>
                      ) : (
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => {
                            setSelectedId(row.user_id);
                            setDrawerError(null);
                            setRoleToAdd("");
                          }}
                        >
                          Manage roles
                        </Button>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        </Container>
      )}

      <Drawer
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
          }
        }}
      >
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Manage roles</Drawer.Title>
            <Drawer.Description>{selected?.email}</Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4">
            {drawerError && (
              <Alert variant="error" role="alert">
                {drawerError}
              </Alert>
            )}
            <div className="flex flex-col gap-y-2">
              <Text size="small" leading="compact" weight="plus">
                Current roles
              </Text>
              {selected?.roles.length === 0 && (
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  No roles
                </Text>
              )}
              {selected?.roles.map((role) => (
                <div key={role} className="flex items-center justify-between">
                  <Badge size="2xsmall" color={role === "superadmin" ? "purple" : "grey"}>
                    {roleLabel(role)}
                  </Badge>
                  <Button
                    size="small"
                    variant="secondary"
                    aria-label={`Revoke ${roleLabel(role)}`}
                    disabled={revoke.isPending}
                    onClick={() => selected && void confirmRevoke(selected, role)}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Add a role
              </Label>
              <Select value={roleToAdd} onValueChange={setRoleToAdd}>
                <Select.Trigger>
                  <Select.Value placeholder="Choose a role" />
                </Select.Trigger>
                <Select.Content>
                  {assignable.map((role) => (
                    <Select.Item key={role.key} value={role.key}>
                      {role.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button size="small" variant="secondary">
                Close
              </Button>
            </Drawer.Close>
            <Button
              size="small"
              disabled={!roleToAdd || assign.isPending}
              isLoading={assign.isPending}
              onClick={() =>
                selected && assign.mutate({ userId: selected.user_id, role: roleToAdd })
              }
            >
              Assign role
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>

      <Drawer
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setClosing(null);
          }
        }}
      >
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Close break-glass review</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4">
            {closeError && (
              <Alert variant="error" role="alert">
                {closeError}
              </Alert>
            )}
            <div className="flex items-center gap-x-2">
              <Checkbox
                id="rotated-confirmed"
                checked={rotated}
                onCheckedChange={(value) => setRotated(value === true)}
              />
              <Label htmlFor="rotated-confirmed" size="small">
                I have rotated the break-glass credentials
              </Label>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="review-note" size="small" weight="plus">
                Note
              </Label>
              <Textarea
                id="review-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What happened and what you checked (at least 10 characters)"
              />
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </Drawer.Close>
            <Button
              size="small"
              disabled={!rotated || note.trim().length < 10 || close.isPending}
              isLoading={close.isPending}
              onClick={() => closing && close.mutate({ reviewId: closing.id, note: note.trim() })}
            >
              Close review
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Staff",
});

export default StaffPage;
