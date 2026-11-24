import { Button, Heading, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./layout";
import { safeHttpUrl } from "./lib/safe-url";
import * as s from "./lib/styles";

/** Sent once to a new vendor. Holds the store name, the link and the expiry, nothing else. */
export type VendorInviteProps = {
  store_name: string;
  contact_name: string;
  accept_url: string;
  /** For example "Friday 27 November 2026, 18:30 IST" */
  expires_label: string;
  expiry_hours: number;
};

export const vendorInviteSubject = (props: VendorInviteProps): string =>
  `Your invitation to ${props.store_name}`;

export const vendorInviteText = (props: VendorInviteProps): string =>
  [
    `Hello ${props.contact_name},`,
    `${props.store_name} has invited you to set up a vendor account.`,
    `Open this link to choose your password: ${safeHttpUrl(props.accept_url) ?? ""}`,
    `The link can be used once and stays valid for ${props.expiry_hours} hours, until ${props.expires_label}.`,
    "If you did not expect this message, ignore it.",
  ].join("\n\n");

export function VendorInviteEmail(props: VendorInviteProps) {
  const href = safeHttpUrl(props.accept_url);

  return (
    <EmailLayout preview={vendorInviteSubject(props)}>
      <Heading style={s.heading}>Your invitation to {props.store_name}</Heading>

      <Text style={s.paragraph}>Hello {props.contact_name},</Text>

      <Text style={s.paragraph}>
        {props.store_name} has invited you to set up a vendor account.
      </Text>

      {href ? (
        <Section style={s.buttonSection}>
          <Button href={href} style={s.button}>
            Set up your account
          </Button>
        </Section>
      ) : null}

      <Text style={s.paragraph}>
        The link can be used once and stays valid for {props.expiry_hours} hours,
        until {props.expires_label}.
      </Text>

      <Text style={s.hint}>If you did not expect this message, ignore it.</Text>
    </EmailLayout>
  );
}

export default VendorInviteEmail;
