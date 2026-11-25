import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Badge, Button, Container, Heading, Table, Tabs, Text } from "@medusajs/ui";
import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState, NoAccessState } from "../../lib/page-states";
import {
  PAGE_SIZE,
  REVIEW_TABS,
  type ReviewTab,
  ageInDays,
  describeError,
  exactTime,
  relativeTime,
  useReviews,
} from "../../lib/product-reviews";

const ProductReviewsPage = () => {
  const [tab, setTab] = useState<ReviewTab>("new");
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading, isError, refetch } = useReviews(tab, offset);
  const failure = isError ? describeError(error) : null;

  const changeTab = (value: string) => {
    setTab(value as ReviewTab);
    setOffset(0);
  };

  const count = data?.count ?? 0;
  const hasPrevious = offset > 0;
  const hasNext = offset + PAGE_SIZE < count;

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Product reviews</Heading>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Check each product before it goes on sale. Oldest first.
        </Text>
      </div>

      <div className="px-6 py-3">
        <Tabs value={tab} onValueChange={changeTab}>
          <Tabs.List>
            {REVIEW_TABS.map((item) => (
              <Tabs.Trigger key={item.key} value={item.key} data-testid={`tab-${item.key}`}>
                {item.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs>
      </div>

      {failure?.forbidden ? (
        <NoAccessState message="You do not have access to product reviews." />
      ) : failure ? (
        <ErrorState message={failure.message} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <LoadingState label="Loading product reviews" />
      ) : data.reviews.length === 0 ? (
        <EmptyState message="Nothing is waiting here." />
      ) : (
        <>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Title</Table.HeaderCell>
                <Table.HeaderCell>Type</Table.HeaderCell>
                <Table.HeaderCell>Submitted</Table.HeaderCell>
                <Table.HeaderCell>Revision</Table.HeaderCell>
                <Table.HeaderCell>
                  <span className="sr-only">Open</span>
                </Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.reviews.map((review) => {
                const when = tab === "new" || tab === "live_edits" ? review.submitted_at : review.decided_at;
                const days = ageInDays(review.submitted_at);
                const overdue = tab === "new" && days !== null && days > 2;
                return (
                  <Table.Row key={review.id} data-testid="review-row">
                    <Table.Cell>{review.title}</Table.Cell>
                    <Table.Cell>
                      {review.is_live ? <Badge color="blue">Live edit</Badge> : <Badge color="grey">New product</Badge>}
                    </Table.Cell>
                    <Table.Cell>
                      <span title={exactTime(when)}>{relativeTime(when)}</span>{" "}
                      {tab === "new" && days !== null ? (
                        <Badge color={overdue ? "orange" : "grey"}>
                          {days === 1 ? "1 day" : `${days} days`}
                        </Badge>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell>{review.revision}</Table.Cell>
                    <Table.Cell>
                      <Link to={`/product-reviews/${review.id}`} className="text-ui-fg-interactive">
                        Open
                      </Link>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
          <div className="flex items-center justify-between px-6 py-3">
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              {offset + 1} to {Math.min(offset + PAGE_SIZE, count)} of {count}
            </Text>
            <div className="flex gap-x-2">
              <Button
                size="small"
                variant="secondary"
                disabled={!hasPrevious}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                size="small"
                variant="secondary"
                disabled={!hasNext}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Container>
  );
};

export const config = defineRouteConfig({ label: "Product reviews" });

export default ProductReviewsPage;
