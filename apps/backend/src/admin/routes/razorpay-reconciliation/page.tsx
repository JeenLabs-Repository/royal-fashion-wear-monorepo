import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Badge, Button, Container, Heading, Prompt, Table, Text, toast } from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { sdk } from "../../lib/client";
import { EmptyState, ErrorState, LoadingState, NoAccessState } from "../../lib/page-states";
import {
  RUN_STATUS_COLORS,
  describeAge,
  failureOf,
  formatInr,
  formatIst,
  kindLabel,
  type ItemView,
  type RefundResult,
  type RunView,
} from "../../lib/razorpay-payments";

const KEY = "razorpay-reconciliation";

const copyId = async (id: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(id);
    toast.success("Copied");
  } catch {
    toast.error("Could not copy");
  }
};

const PaymentReconciliationPage = () => {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<ItemView | null>(null);

  const runs = useQuery({
    queryKey: [KEY, "runs"],
    queryFn: () =>
      sdk.client.fetch<{ runs: RunView[] }>("/admin/razorpay/reconciliation", {
        query: { limit: 20 },
      }),
  });

  const activeId = selected ?? runs.data?.runs[0]?.id ?? null;

  const detail = useQuery({
    queryKey: [KEY, "run", activeId],
    enabled: Boolean(activeId),
    queryFn: () =>
      sdk.client.fetch<{ run: RunView; items: ItemView[] }>(
        `/admin/razorpay/reconciliation/${encodeURIComponent(activeId as string)}`
      ),
  });

  const refund = useMutation({
    mutationFn: (itemId: string) =>
      sdk.client.fetch<RefundResult>(
        `/admin/razorpay/reconciliation/items/${encodeURIComponent(itemId)}/refund`,
        { method: "POST", body: {} }
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });

  const confirmRefund = () => {
    if (!target) {
      return;
    }
    refund.mutate(target.id, {
      onSuccess: (result) =>
        toast.success("Refund requested", { description: `Status: ${result.status}` }),
      onError: (error) =>
        toast.error("Refund failed", { description: failureOf(error).message }),
    });
    setTarget(null);
  };

  // A 403 answer means the signed-in role may not view payments.
  const runsFailure = runs.error ? failureOf(runs.error) : null;
  const detailFailure = detail.error ? failureOf(detail.error) : null;

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">Payment reconciliation</Heading>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Every day at 02:30 IST the store compares the last 48 hours of Razorpay payments with
            its own payments and orders. Anything that does not match is listed here.
          </Text>
        </div>

        {runsFailure?.forbidden ? (
          <NoAccessState message="You do not have access to payment reconciliation." />
        ) : runsFailure ? (
          <ErrorState message={runsFailure.message} onRetry={() => runs.refetch()} />
        ) : runs.isLoading || !runs.data ? (
          <LoadingState label="Loading reconciliation runs" />
        ) : runs.data.runs.length === 0 ? (
          <EmptyState message="No reconciliation runs yet. The first run happens at 02:30 IST." />
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Started</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Scanned</Table.HeaderCell>
                <Table.HeaderCell>Mismatches</Table.HeaderCell>
                <Table.HeaderCell>
                  <span className="sr-only">Notes</span>
                </Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {runs.data.runs.map((run) => (
                <Table.Row
                  key={run.id}
                  data-testid="run-row"
                  className={`cursor-pointer ${run.id === activeId ? "bg-ui-bg-highlight" : ""}`}
                  onClick={() => setSelected(run.id)}
                >
                  <Table.Cell>{formatIst(run.started_at)}</Table.Cell>
                  <Table.Cell>
                    <Badge color={RUN_STATUS_COLORS[run.status] ?? "grey"}>{run.status}</Badge>
                  </Table.Cell>
                  <Table.Cell>{run.scanned_count}</Table.Cell>
                  <Table.Cell>{run.mismatch_count}</Table.Cell>
                  <Table.Cell>
                    {run.truncated ? <Badge color="orange">Truncated</Badge> : null}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      {activeId && !runsFailure ? (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Items in this run</Heading>
          </div>
          {detailFailure?.forbidden ? (
            <NoAccessState message="You do not have access to payment reconciliation." />
          ) : detailFailure ? (
            <ErrorState message={detailFailure.message} onRetry={() => detail.refetch()} />
          ) : detail.isLoading || !detail.data ? (
            <LoadingState label="Loading items" />
          ) : detail.data.items.length === 0 ? (
            <EmptyState message="Nothing to review. Every payment in this run matched." />
          ) : (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>What happened</Table.HeaderCell>
                  <Table.HeaderCell>Razorpay payment</Table.HeaderCell>
                  <Table.HeaderCell>Amount</Table.HeaderCell>
                  <Table.HeaderCell>Age</Table.HeaderCell>
                  <Table.HeaderCell>State</Table.HeaderCell>
                  <Table.HeaderCell>
                    <span className="sr-only">Action</span>
                  </Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {detail.data.items.map((item) => (
                  <Table.Row key={item.id} data-testid="item-row">
                    <Table.Cell>{kindLabel(item.kind)}</Table.Cell>
                    <Table.Cell>
                      {item.razorpay_payment_id ? (
                        <span className="flex items-center gap-x-2">
                          <span className="font-mono text-xs">{item.razorpay_payment_id}</span>
                          <Button
                            size="small"
                            variant="transparent"
                            onClick={() => copyId(item.razorpay_payment_id as string)}
                          >
                            Copy
                          </Button>
                        </span>
                      ) : (
                        "None"
                      )}
                    </Table.Cell>
                    <Table.Cell>{formatInr(item.amount_inr)}</Table.Cell>
                    <Table.Cell>{describeAge(item.age_hours)}</Table.Cell>
                    <Table.Cell data-testid="item-state">
                      <Badge color={item.resolved_at ? "green" : "orange"}>
                        {item.resolved_at ? "Resolved" : "Open"}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {item.refundable ? (
                        <Button
                          size="small"
                          variant="secondary"
                          data-testid="refund-button"
                          disabled={refund.isPending}
                          onClick={() => setTarget(item)}
                        >
                          Refund in full
                        </Button>
                      ) : null}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </Container>
      ) : null}

      <Prompt open={target !== null} onOpenChange={(open) => (open ? undefined : setTarget(null))}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Refund this payment in full?</Prompt.Title>
            <Prompt.Description>
              {target
                ? `Payment ${target.razorpay_payment_id} of ${formatInr(target.amount_inr)} will be refunded to the customer. This cannot be undone.`
                : ""}
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Cancel</Prompt.Cancel>
            <Prompt.Action disabled={refund.isPending} onClick={confirmRefund}>
              Refund in full
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Payment reconciliation",
});

export default PaymentReconciliationPage;
