import { Button, Heading, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./layout";
import { safeHttpUrl } from "./lib/safe-url";
import * as s from "./lib/styles";

/** A short operational message to staff. Typed props only, no free-form fields. */
export type StaffAlertProps = {
  subject: string;
  heading: string;
  lines: string[];
  link?: { label: string; url: string };
};

export function StaffAlertEmail({ subject, heading, lines, link }: StaffAlertProps) {
  const href = safeHttpUrl(link?.url);

  return (
    <EmailLayout preview={subject}>
      <Heading style={s.heading}>{heading}</Heading>

      {lines.map((line, index) => (
        <Text key={index} style={s.paragraph}>
          {line}
        </Text>
      ))}

      {link && href ? (
        <Section style={s.buttonSection}>
          <Button href={href} style={s.button}>
            {link.label}
          </Button>
        </Section>
      ) : null}
    </EmailLayout>
  );
}

export default StaffAlertEmail;
