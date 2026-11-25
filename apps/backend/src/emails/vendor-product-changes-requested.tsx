import { Button, Heading, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./layout";
import { safeHttpUrl } from "./lib/safe-url";
import * as s from "./lib/styles";

/** Sent to the vendor when the approver asks for changes. The reason is printed as plain text. */
export type VendorProductChangesRequestedProps = {
  product_title: string;
  reason: string;
  portal_url: string;
};

export const vendorProductChangesRequestedSubject = (
  _props: VendorProductChangesRequestedProps
): string => "Changes requested on your product";

export const vendorProductChangesRequestedText = (props: VendorProductChangesRequestedProps): string =>
  [
    `Changes are needed on your product "${props.product_title}" before it can be approved.`,
    `What to change: ${props.reason}`,
    `Edit and submit it again: ${safeHttpUrl(props.portal_url) ?? ""}`,
  ].join("\n\n");

export function VendorProductChangesRequestedEmail(props: VendorProductChangesRequestedProps) {
  const href = safeHttpUrl(props.portal_url);

  return (
    <EmailLayout preview={vendorProductChangesRequestedSubject(props)}>
      <Heading style={s.heading}>Changes requested on your product</Heading>
      <Text style={s.paragraph}>
        Changes are needed on your product &quot;{props.product_title}&quot; before it can be approved.
      </Text>
      <Text style={s.paragraph}>What to change: {props.reason}</Text>
      {href ? (
        <Section style={s.buttonSection}>
          <Button href={href} style={s.button}>
            Edit and submit again
          </Button>
        </Section>
      ) : null}
    </EmailLayout>
  );
}

export default VendorProductChangesRequestedEmail;
