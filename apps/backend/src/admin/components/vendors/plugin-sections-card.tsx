import { Container, Heading, Text } from "@medusajs/ui";
import { Link } from "react-router-dom";
import { type VendorSection, isSafeSectionPath } from "../../lib/vendors-api";

// Links go through the router. A path that is not a plain relative admin path is dropped.
export const PluginSectionsCard = ({ sections }: { sections: VendorSection[] }) => {
  const safe = sections.filter((section) => isSafeSectionPath(section.path));
  if (safe.length === 0) {
    return null;
  }
  return (
    <Container className="flex flex-col gap-y-3 px-6 py-4" data-testid="plugin-sections">
      <Heading level="h2">Plugin sections</Heading>
      <ul className="flex flex-col gap-y-2">
        {safe.map((section) => (
          <li key={section.key}>
            <Link
              to={section.path}
              data-testid={`section-link-${section.key}`}
              className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
            >
              <Text size="small" leading="compact" weight="plus" className="text-inherit">
                {section.title}
              </Text>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
};
