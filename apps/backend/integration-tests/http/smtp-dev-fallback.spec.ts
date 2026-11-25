import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";

jest.setTimeout(60 * 1000);

type MailpitMessage = {
  ID: string;
  Subject: string;
  From: { Name: string; Address: string };
};

const mailpitUrl = process.env.MAILPIT_URL;

const waitFor = async <T>(
  probe: () => Promise<T | undefined>,
  timeoutMs: number
): Promise<T | undefined> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
};

if (!mailpitUrl) {
  console.info(
    "[smtp-dev-fallback] MAILPIT_URL is not set, skipping the mail catcher test"
  );
  describe.skip("smtp development fallback", () => {
    it("delivers to the local mail catcher", () => undefined);
  });
} else {
  medusaIntegrationTestRunner({
    testSuite: ({ getContainer }) => {
      describe("smtp development fallback", () => {
        const keys = [
          "SMTP_HOST",
          "SMTP_PORT",
          "SMTP_SECURE",
          "SMTP_USER",
          "SMTP_PASS",
          "SMTP_FROM",
          "STORE_NAME",
        ];
        const saved: Record<string, string | undefined> = {};

        beforeAll(() => {
          for (const key of keys) {
            saved[key] = process.env[key];
          }
          process.env.SMTP_HOST = "127.0.0.1";
          process.env.SMTP_PORT = process.env.MAILPIT_SMTP_PORT ?? "1025";
          process.env.SMTP_SECURE = "false";
          process.env.SMTP_USER = "";
          process.env.SMTP_PASS = "";
          process.env.SMTP_FROM = "shop@example.test";
          process.env.STORE_NAME = "Fallback Test Store";
        });

        afterAll(async () => {
          for (const key of keys) {
            if (saved[key] === undefined) {
              delete process.env[key];
            } else {
              process.env[key] = saved[key];
            }
          }
          await fetch(`${mailpitUrl}/api/v1/messages`, { method: "DELETE" });
        });

        it("delivers to the local mail catcher", async () => {
          const notifications = getContainer().resolve(Modules.NOTIFICATION);
          const subject = `fallback-check-${Date.now()}`;

          await notifications.createNotifications({
            to: "buyer@example.test",
            channel: "email",
            template: "fallback-check",
            content: { subject, html: "<p>hello</p>", text: "hello" },
          } as Parameters<typeof notifications.createNotifications>[0]);

          const message = await waitFor(async () => {
            const response = await fetch(`${mailpitUrl}/api/v1/messages`);
            const body = (await response.json()) as {
              messages: MailpitMessage[];
            };
            return body.messages.find((item) => item.Subject === subject);
          }, 10_000);

          expect(message).toBeDefined();
          expect(message?.From.Address).toBe("shop@example.test");
          expect(message?.From.Name).toBe("Fallback Test Store");
        });
      });
    },
  });
}
