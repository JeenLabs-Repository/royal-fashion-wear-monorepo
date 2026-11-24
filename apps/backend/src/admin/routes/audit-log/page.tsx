import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Table,
  Text,
  toast,
} from "@medusajs/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoAccessState,
} from "../../lib/page-states";
import {
  type AuditEntry,
  type AuditFilters,
  auditKeys,
  fetchAuditLog,
} from "../../lib/audit-api";
import { errorMessage, isForbidden } from "../../lib/staff-api";

const NO_ACCESS_MESSAGE = "You do not have access to the audit log. Ask a superadmin.";

const startOfDay = (value: string) => new Date(`${value}T00:00:00`).toISOString();
const endOfDay = (value: string) => new Date(`${value}T23:59:59.999`).toISOString();

// Values come from requests, so they are shown as text and never as markup.
const asText = (value: unknown) =>
  value === null || value === undefined ? "None" : JSON.stringify(value, null, 2);

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-y-1">
    <Text size="small" leading="compact" weight="plus">
      {label}
    </Text>
    <Text size="small" leading="compact" className="break-all text-ui-fg-subtle">
      {value}
    </Text>
  </div>
);

const AuditLogPage = () => {
  const [draft, setDraft] = useState({
    from: "",
    to: "",
    actor: "",
    action_prefix: "",
    target_id: "",
  });
  const [applied, setApplied] = useState<AuditFilters>({});
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const list = useInfiniteQuery({
    queryKey: auditKeys.list(applied),
    queryFn: ({ pageParam }) => fetchAuditLog(applied, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: false,
  });

  useEffect(() => {
    if (list.error && !isForbidden(list.error)) {
      toast.error(errorMessage(list.error));
    }
  }, [list.error]);

  const apply = () =>
    setApplied({
      from: draft.from ? startOfDay(draft.from) : undefined,
      to: draft.to ? endOfDay(draft.to) : undefined,
      actor: draft.actor.trim() || undefined,
      action_prefix: draft.action_prefix.trim() || undefined,
      target_id: draft.target_id.trim() || undefined,
    });

  const clear = () => {
    setDraft({ from: "", to: "", actor: "", action_prefix: "", target_id: "" });
    setApplied({});
  };

  if (list.error && isForbidden(list.error)) {
    return <NoAccessState message={NO_ACCESS_MESSAGE} />;
  }

  const entries = list.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="flex flex-col gap-y-4 px-6 py-4">
        <Heading>Audit log</Heading>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="audit-from" size="small">
              From date
            </Label>
            <Input
              id="audit-from"
              type="date"
              size="small"
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="audit-to" size="small">
              To date
            </Label>
            <Input
              id="audit-to"
              type="date"
              size="small"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="audit-actor" size="small">
              Actor
            </Label>
            <Input
              id="audit-actor"
              size="small"
              value={draft.actor}
              onChange={(event) => setDraft({ ...draft, actor: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="audit-action" size="small">
              Action prefix
            </Label>
            <Input
              id="audit-action"
              size="small"
              value={draft.action_prefix}
              onChange={(event) => setDraft({ ...draft, action_prefix: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="audit-target" size="small">
              Target id
            </Label>
            <Input
              id="audit-target"
              size="small"
              value={draft.target_id}
              onChange={(event) => setDraft({ ...draft, target_id: event.target.value })}
            />
          </div>
        </div>
        <div className="flex gap-x-2">
          <Button size="small" onClick={apply}>
            Apply
          </Button>
          <Button size="small" variant="secondary" onClick={clear}>
            Clear
          </Button>
        </div>
      </Container>

      {list.isLoading ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState
          message={errorMessage(list.error)}
          onRetry={() => {
            void list.refetch();
          }}
        />
      ) : entries.length === 0 ? (
        <EmptyState message="No audit entries match these filters." />
      ) : (
        <Container className="p-0">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>When</Table.HeaderCell>
                <Table.HeaderCell>Actor</Table.HeaderCell>
                <Table.HeaderCell>Action</Table.HeaderCell>
                <Table.HeaderCell>Target</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {entries.map((entry) => (
                <Table.Row key={entry.id}>
                  <Table.Cell>{new Date(entry.at).toLocaleString()}</Table.Cell>
                  <Table.Cell>
                    {entry.actor_label ?? entry.actor_id ?? entry.actor_type}
                  </Table.Cell>
                  <Table.Cell>{entry.action}</Table.Cell>
                  <Table.Cell>
                    {entry.target_type
                      ? `${entry.target_type} ${entry.target_id ?? ""}`.trim()
                      : "None"}
                  </Table.Cell>
                  <Table.Cell>{entry.http_status ?? "None"}</Table.Cell>
                  <Table.Cell className="text-right">
                    <Button size="small" variant="secondary" onClick={() => setSelected(entry)}>
                      Details
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          {list.hasNextPage && (
            <div className="flex justify-center px-6 py-4">
              <Button
                size="small"
                variant="secondary"
                isLoading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          )}
        </Container>
      )}

      <Drawer
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
          }
        }}
      >
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Audit entry</Drawer.Title>
            <Drawer.Description>{selected?.action}</Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
            {selected && (
              <>
                <Field label="Time" value={new Date(selected.at).toISOString()} />
                <Field
                  label="Actor"
                  value={`${selected.actor_label ?? "unknown"} (${selected.actor_type} ${selected.actor_id ?? ""})`}
                />
                <Field label="Roles" value={asText(selected.roles)} />
                <Field
                  label="Request"
                  value={
                    `${selected.http_method ?? ""} ${selected.http_path ?? ""} ${selected.http_route ?? ""}`.trim() ||
                    "None"
                  }
                />
                <Field
                  label="Network"
                  value={`ip ${selected.ip ?? "none"}, forwarded ${selected.forwarded_for ?? "none"}`}
                />
                <Field label="Request id" value={selected.request_id ?? "None"} />
                <div className="flex flex-col gap-y-1">
                  <Text size="small" leading="compact" weight="plus">
                    Before
                  </Text>
                  <pre className="overflow-x-auto rounded-md bg-ui-bg-subtle p-3 text-xs">
                    {asText(selected.before)}
                  </pre>
                </div>
                <div className="flex flex-col gap-y-1">
                  <Text size="small" leading="compact" weight="plus">
                    After
                  </Text>
                  <pre className="overflow-x-auto rounded-md bg-ui-bg-subtle p-3 text-xs">
                    {asText(selected.after)}
                  </pre>
                </div>
                <div className="flex flex-col gap-y-1">
                  <Text size="small" leading="compact" weight="plus">
                    Meta
                  </Text>
                  <pre className="overflow-x-auto rounded-md bg-ui-bg-subtle p-3 text-xs">
                    {asText(selected.meta)}
                  </pre>
                </div>
              </>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button size="small" variant="secondary">
                Close
              </Button>
            </Drawer.Close>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Audit log",
});

export default AuditLogPage;
