import { defineWidgetConfig } from "@medusajs/admin-sdk";
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types";
import { Badge, Container, Heading, Table, Text } from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";
import { sdk } from "../lib/client";
import { EmptyState, ErrorState, LoadingState } from "../lib/page-states";
import {
  RAZORPAY_PROVIDER_ID,
  REFUND_STATUS_COLORS,
  failureOf,
  formatInr,
  formatIst,
  isOpenRefund,
  type RefundView,
} from "../lib/razorpay-payments";

const POLL_MS = 30_000;

type PaymentLine = { id: string; provider_id?: string };

const RazorpayRefundsWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  // <RESOLVE: confirm the field list syntax and the retrieve response key. Command:
  // grep -n "retrieve" apps/backend/node_modules/@medusajs/js-sdk/dist/admin/order.d.ts | head -n 4>
  const payment = useQuery({
    queryKey: ["razorpay-order-payment", order.id],
    queryFn: () =>
      sdk.admin.order.retrieve(order.id, {
        fields: "payment_collections.payments.id,payment_collections.payments.provider_id",
      }),
  });

  const lines = (payment.data?.order?.payment_collections ?? []).flatMap(
    (collection) => (collection.payments ?? []) as PaymentLine[]
  );
  const razorpayPayment = lines.find((line) => line.provider_id === RAZORPAY_PROVIDER_ID);
  const paymentId = razorpayPayment?.id ?? null;

  const refunds = useQuery({
    queryKey: ["razorpay-refunds", paymentId],
    enabled: Boolean(paymentId),
    queryFn: () =>
      sdk.client.fetch<{ refunds: RefundView[] }>("/admin/razorpay/refunds", {
        query: { payment_id: paymentId },
      }),
    refetchOnWindowFocus: true,
    // Poll only while a refund is still in flight, never otherwise.
    refetchInterval: (query) =>
      query.state.data?.refunds.some((refund) => isOpenRefund(refund.status)) ? POLL_MS : false,
  });

  if (!paymentId) {
    return null;
  }

  const failure = refunds.error ? failureOf(refunds.error) : null;
  // The routes answer 403 for roles without finance access, so those staff see no widget at all.
  if (failure?.forbidden) {
    return null;
  }

  return (
    <Container className="divide-y p-0" data-testid="razorpay-refunds-widget">
      <div className="px-6 py-4">
        <Heading level="h2">Razorpay refunds</Heading>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Refunds can take several days to reach the customer. A refund that fails alerts finance.
        </Text>
      </div>
      {failure ? (
        <ErrorState message={failure.message} onRetry={() => refunds.refetch()} />
      ) : refunds.isLoading || !refunds.data ? (
        <LoadingState label="Loading refunds" />
      ) : refunds.data.refunds.length === 0 ? (
        <EmptyState message="No refunds for this payment." />
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Refund</Table.HeaderCell>
              <Table.HeaderCell>Amount</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Updated</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {refunds.data.refunds.map((refund) => (
              <Table.Row key={refund.razorpay_refund_id} data-testid="refund-row">
                <Table.Cell className="font-mono text-xs">{refund.razorpay_refund_id}</Table.Cell>
                <Table.Cell>{formatInr(refund.amount_inr)}</Table.Cell>
                <Table.Cell>
                  <Badge color={REFUND_STATUS_COLORS[refund.status] ?? "grey"}>
                    {refund.status}
                  </Badge>
                </Table.Cell>
                <Table.Cell>{formatIst(refund.updated_at)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Container>
  );
};

export const config = defineWidgetConfig({ zone: "order.details.after" });

export default RazorpayRefundsWidget;
