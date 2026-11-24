import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { render } from "@react-email/render";
import { createElement } from "react";
import BreakGlassReviewReminderEmail from "../../break-glass-review-reminder";
import BreakGlassUsedEmail from "../../break-glass-used";
import StaffAlertEmail from "../../staff-alert";
import { buildIdempotencyKey, sendTemplatedEmail } from "../send-email";
import { EMAIL_TEMPLATES } from "../templates";

const makeContainer = (
  createNotifications: jest.Mock = jest.fn(async () => [])
) => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const container = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.LOGGER) return logger;
      if (key === Modules.NOTIFICATION) return { createNotifications };
      throw new Error(`unexpected key ${key}`);
    },
  } as unknown as MedusaContainer;
  return { container, logger, createNotifications };
};

const alertProps = {
  subject: "Vendor signed up",
  heading: "A vendor signed up",
  lines: ["First line of detail", "Second line of detail"],
};

describe("staff-alert template", () => {
  test("renders the heading and every line", async () => {
    const html = await render(createElement(StaffAlertEmail, alertProps));
    expect(html).toContain("A vendor signed up");
    expect(html).toContain("First line of detail");
    expect(html).toContain("Second line of detail");
  });

  test("escapes markup passed in a prop", async () => {
    const html = await render(
      createElement(StaffAlertEmail, {
        ...alertProps,
        lines: ["<script>alert(1)</script>"],
      })
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("drops a link whose URL is not http or https", async () => {
    const html = await render(
      createElement(StaffAlertEmail, {
        ...alertProps,
        link: { label: "Open it", url: "javascript:alert(1)" },
      })
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Open it");
  });

  test("keeps a link with an https URL", async () => {
    const html = await render(
      createElement(StaffAlertEmail, {
        ...alertProps,
        link: { label: "Open it", url: "https://admin.example.test/app" },
      })
    );
    expect(html).toContain("https://admin.example.test/app");
  });
});

describe("break-glass templates", () => {
  test("the used email states what happened, when, from where and what to do", async () => {
    const props = {
      whenUtc: "2026-01-02 03:04",
      whenIst: "2026-01-02 08:34",
      ip: "203.0.113.9",
      forwardedFor: "198.51.100.7",
      method: "GET",
      route: "/admin/orders",
      reviewUrl: "https://admin.example.test/app/staff",
    };
    const html = await render(createElement(BreakGlassUsedEmail, props));
    expect(html).toContain("203.0.113.9");
    expect(html).toContain("2026-01-02 08:34");
    expect(html).toContain("rotate the break-glass credentials");
    expect(EMAIL_TEMPLATES["break-glass-used"].subject(props)).toBe(
      "Break-glass account used at 2026-01-02 08:34"
    );
  });

  test("the reminder subject states the hours", async () => {
    const props = {
      openedAtIst: "2026-01-02 08:34",
      hoursOpen: 30,
      reviewUrl: "https://admin.example.test/app/staff",
    };
    const html = await render(createElement(BreakGlassReviewReminderEmail, props));
    expect(html).toContain("30 hours");
    expect(EMAIL_TEMPLATES["break-glass-review-reminder"].subject(props)).toBe(
      "Break-glass review still open after 30 hours"
    );
  });
});

describe("buildIdempotencyKey", () => {
  test("joins three parts with colons", () => {
    expect(buildIdempotencyKey("vendor-signup", "ven_1", "2026-01-02")).toBe(
      "vendor-signup:ven_1:2026-01-02"
    );
  });

  test("rejects an empty part or a part with a colon", () => {
    expect(() => buildIdempotencyKey("", "a", "b")).toThrow();
    expect(() => buildIdempotencyKey("a", "", "b")).toThrow();
    expect(() => buildIdempotencyKey("a", "b", "c:d")).toThrow();
  });
});

describe("sendTemplatedEmail", () => {
  const key = "vendor-signup:ven_1:2026-01-02";

  test("hands one rendered email to the notification module and returns true", async () => {
    const { container, createNotifications } = makeContainer();
    const ok = await sendTemplatedEmail({
      container,
      template: "staff-alert",
      to: "owner@example.test",
      props: alertProps,
      idempotencyKey: key,
      tag: "unit",
    });
    expect(ok).toBe(true);
    expect(createNotifications).toHaveBeenCalledTimes(1);
    const call = createNotifications.mock.calls[0][0];
    expect(call.to).toBe("owner@example.test");
    expect(call.channel).toBe("email");
    expect(call.template).toBe("staff-alert");
    expect(call.idempotency_key).toBe(key);
    expect(call.content.subject).toBe("Vendor signed up");
    expect(call.content.html).toContain("First line of detail");
    expect(call.content.text).toContain("Second line of detail");
  });

  test("strips line breaks from the subject and caps it at 150 characters", async () => {
    const { container, createNotifications } = makeContainer();
    await sendTemplatedEmail({
      container,
      template: "staff-alert",
      to: "owner@example.test",
      props: { ...alertProps, subject: `Hello\r\nBcc: x@example.test${"y".repeat(300)}` },
      idempotencyKey: key,
    });
    const subject = createNotifications.mock.calls[0][0].content.subject as string;
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject.length).toBeLessThanOrEqual(150);
  });

  test("returns false and logs the tag when the notification module rejects, and never throws", async () => {
    const { container, logger } = makeContainer(
      jest.fn(async () => {
        throw new Error("smtp down");
      })
    );
    const ok = await sendTemplatedEmail({
      container,
      template: "staff-alert",
      to: "owner@example.test",
      props: alertProps,
      idempotencyKey: key,
      tag: "unit",
    });
    expect(ok).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      "[unit] failed to send staff-alert: smtp down"
    );
  });

  test("a malformed idempotency key warns and still sends", async () => {
    const { container, logger, createNotifications } = makeContainer();
    const ok = await sendTemplatedEmail({
      container,
      template: "staff-alert",
      to: "owner@example.test",
      props: alertProps,
      idempotencyKey: "not-a-key",
      tag: "unit",
    });
    expect(ok).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
    expect(createNotifications).toHaveBeenCalledTimes(1);
  });

  test("an array of recipients gets one call per address with distinct keys", async () => {
    const { container, createNotifications } = makeContainer();
    const ok = await sendTemplatedEmail({
      container,
      template: "staff-alert",
      to: ["a@example.test", "b@example.test"],
      props: alertProps,
      idempotencyKey: key,
    });
    expect(ok).toBe(true);
    expect(createNotifications).toHaveBeenCalledTimes(2);
    const keys = createNotifications.mock.calls.map(
      (call: any[]) => call[0].idempotency_key as string
    );
    expect(new Set(keys).size).toBe(2);
    for (const k of keys) {
      expect(k.startsWith(`${key}:`)).toBe(true);
    }
  });

  test("the same address always gets the same key, so a repeat send is a no-op downstream", async () => {
    const { container, createNotifications } = makeContainer();
    for (let i = 0; i < 2; i += 1) {
      await sendTemplatedEmail({
        container,
        template: "staff-alert",
        to: ["A@Example.test"],
        props: alertProps,
        idempotencyKey: key,
      });
    }
    const [first, second] = createNotifications.mock.calls.map(
      (call: any[]) => call[0].idempotency_key
    );
    expect(first).toBe(second);
  });

  test("no recipients logs a warning, sends nothing and returns false", async () => {
    const { container, logger, createNotifications } = makeContainer();
    const ok = await sendTemplatedEmail({
      container,
      template: "staff-alert",
      to: [],
      props: alertProps,
      idempotencyKey: key,
    });
    expect(ok).toBe(false);
    expect(createNotifications).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("returns false when one of several recipients fails", async () => {
    let calls = 0;
    const { container } = makeContainer(
      jest.fn(async () => {
        calls += 1;
        if (calls === 2) throw new Error("second failed");
        return [];
      })
    );
    const ok = await sendTemplatedEmail({
      container,
      template: "staff-alert",
      to: ["a@example.test", "b@example.test"],
      props: alertProps,
      idempotencyKey: key,
    });
    expect(ok).toBe(false);
    expect(calls).toBe(2);
  });
});
