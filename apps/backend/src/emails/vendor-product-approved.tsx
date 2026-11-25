import { Button, Heading, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./layout";
import { safeHttpUrl } from "./lib/safe-url";
import * as s from "./lib/styles";

/** Sent to the vendor when a new product or a live edit is approved. Prints only these fields. */
export type VendorProductApprovedProps = {
  product_title: string;
  /** True when the approval is of a change to a product that was already live. */
  is_live_edit: boolean;
  portal_url: string;
};

export const vendorProductApprovedSubject = (_props: VendorProductApprovedProps): string =>
  "Your product was approved";

const sentence = (props: VendorProductApprovedProps): string =>
  props.is_live_edit
    ? `The changes you made to "${props.product_title}" were approved and are now live.`
    : `Your product "${props.product_title}" was approved and is now on the store.`;

export const vendorProductApprovedText = (props: VendorProductApprovedProps): string =>
  [sentence(props), `Open your products: ${safeHttpUrl(props.portal_url) ?? ""}`].join("\n\n");

export function VendorProductApprovedEmail(props: VendorProductApprovedProps) {
  const href = safeHttpUrl(props.portal_url);

  return (
    <EmailLayout preview={vendorProductApprovedSubject(props)}>
      <Heading style={s.heading}>Your product was approved</Heading>
      <Text style={s.paragraph}>{sentence(props)}</Text>
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

export default VendorProductApprovedEmail;
