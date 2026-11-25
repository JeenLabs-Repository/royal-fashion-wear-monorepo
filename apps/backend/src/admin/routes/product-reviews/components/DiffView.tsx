import { Container, Heading, Text } from "@medusajs/ui";
import type { ReviewDiffEntry } from "../../../lib/product-reviews";

const shown = (value: string | number | boolean | null): string =>
  value === null || value === "" ? "Empty" : String(value);

const Items = ({ items }: { items: { value: string }[] }) =>
  items.length === 0 ? (
    <Text size="small" leading="compact" className="text-ui-fg-muted">
      Empty
    </Text>
  ) : (
    <ol className="list-decimal pl-5">
      {items.map((item, index) => (
        <li key={`${item.value}-${index}`}>
          <Text size="small" leading="compact" className="break-all">
            {item.value}
          </Text>
        </li>
      ))}
    </ol>
  );

export const DiffView = ({ diff }: { diff: ReviewDiffEntry[] }) => {
  if (diff.length === 0) {
    return null;
  }
  return (
    <Container className="divide-y p-0" data-testid="diff-view">
      <div className="px-6 py-4">
        <Heading level="h2">What changed</Heading>
      </div>
      {diff.map((entry) => {
        const isList = entry.before_items.length > 0 || entry.after_items.length > 0;
        return (
          <div key={entry.path} className="grid grid-cols-1 gap-3 px-6 py-3 md:grid-cols-3">
            <Text size="small" leading="compact" weight="plus">
              {entry.path}
            </Text>
            <div data-testid={`diff-before-${entry.path}`}>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                Before
              </Text>
              {isList ? (
                <Items items={entry.before_items} />
              ) : (
                <Text size="small" leading="compact" className="whitespace-pre-wrap">
                  {shown(entry.before)}
                </Text>
              )}
            </div>
            <div data-testid={`diff-after-${entry.path}`}>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                After
              </Text>
              {isList ? (
                <Items items={entry.after_items} />
              ) : (
                <Text size="small" leading="compact" className="whitespace-pre-wrap">
                  {shown(entry.after)}
                </Text>
              )}
            </div>
          </div>
        );
      })}
    </Container>
  );
};
