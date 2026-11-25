import { Button, Heading, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./layout";
import { safeHttpUrl } from "./lib/safe-url";
import * as s from "./lib/styles";

/** Sent to the vendor when a submission is rejected. The reason is printed as plain text. */
export type VendorProductRejectedProps = {
  product_title: string;
  reason: string;
  portal_url: string;
};

export const vendorProductRejectedSubject = (_props: VendorProductRejectedProps): string =>
  "Your product was rejected";

export const vendorProductRejectedText = (props: VendorProductRejectedProps): string =>
  [
    `Your product "${props.product_title}" was rejected.`,
    `Reason: ${props.reason}`,
    `Open your products: ${safeHttpUrl(props.portal_url) ?? ""}`,
  ].join("\n\n");

export function VendorProductRejectedEmail(props: VendorProductRejectedProps) {
  const href = safeHttpUrl(props.portal_url);

  return (
    <EmailLayout preview={vendorProductRejectedSubject(props)}>
      <Heading style={s.heading}>Your product was rejected</Heading>
      <Text style={s.paragraph}>Your product &quot;{props.product_title}&quot; was rejected.</Text>
      <Text style={s.paragraph}>Reason: {props.reason}</Text>
      {href ? (
        <Section style={s.buttonSection}>
          <Button href={href} style={s.button}>
            Open your products
          </Button>
        </Section>
      ) : null}
    </EmailLayout>
  );
}

export default VendorProductRejectedEmail;
