import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MedusaContainer } from "@medusajs/framework";
import { logger } from "@medusajs/framework/logger";
import type { IAuthModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import {
  createCustomerAccountWorkflow,
  createCustomerAddressesWorkflow,
  createUserAccountWorkflow,
} from "@medusajs/medusa/core-flows";
import { getQuery, step } from "./lib/utils";

const FILE_NAME = "TEST-CREDENTIALS.local.md";
const TEMPLATE_PATH = path.join("docs", "testing", "test-credentials.template.md");
const SEED_START = "<!-- seed:start -->";
const SEED_END = "<!-- seed:end -->";
const ACCOUNTS_HEADING = "## Accounts by role";
const RESET_TEXT = "Reset the dev stack, see Reset notes";

type AddressFixture = {
  label: string;
  state: string;
  iso: string;
  city: string;
  pin: string;
  address_1: string;
};

type Account = {
  role: string;
  email: string;
  password: string | null;
};

const findRepoRoot = () => {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("Could not find pnpm-workspace.yaml above the working directory.");
    }
    dir = parent;
  }
};

// The credentials file must be ignored before it exists.
const assertIgnored = (root: string) => {
  try {
    execFileSync("git", ["check-ignore", "-q", FILE_NAME], { cwd: root, stdio: "ignore" });
  } catch {
    throw new Error(
      `${FILE_NAME} is not ignored by git, or git is unavailable. Add it to .gitignore before creating it.`,
    );
  }
};

const loadFixtures = (): AddressFixture[] =>
  JSON.parse(
    readFileSync(path.join(__dirname, "data", "test-data", "india-addresses.json"), "utf8"),
  );

const exists = async (
  container: MedusaContainer,
  entity: "user" | "customer",
  email: string,
) => {
  const { data } = await getQuery(container).graph({
    entity,
    fields: ["id"],
    filters: { email },
  });
  return data.length > 0;
};

const registerIdentity = async (container: MedusaContainer, email: string, password: string) => {
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
  const { success, authIdentity, error } = await auth.register("emailpass", {
    body: { email, password },
  } as Parameters<IAuthModuleService["register"]>[1]);
  if (!success || !authIdentity) {
    throw new Error(`Could not register ${email}: ${error ?? "unknown error"}`);
  }
  return authIdentity.id;
};

const newPassword = () => randomBytes(12).toString("base64url");

const createAdmin = async (container: MedusaContainer, email: string) => {
  if (await exists(container, "user", email)) return null;
  const password = newPassword();
  const authIdentityId = await registerIdentity(container, email, password);
  await createUserAccountWorkflow(container).run({
    input: {
      authIdentityId,
      userData: { email, first_name: "Demo", last_name: "Admin" },
    },
  });
  return password;
};

const createCustomer = async (
  container: MedusaContainer,
  options: { email: string; lastName: string; phone: string; address: AddressFixture },
) => {
  if (await exists(container, "customer", options.email)) return null;
  const password = newPassword();
  const authIdentityId = await registerIdentity(container, options.email, password);
  const { result: customer } = await createCustomerAccountWorkflow(container).run({
    input: {
      authIdentityId,
      customerData: {
        email: options.email,
        first_name: "Demo",
        last_name: options.lastName,
        phone: options.phone,
      },
    },
  });
  // The storefront address form keeps the state name in `province`.
  await createCustomerAddressesWorkflow(container).run({
    input: {
      addresses: [
        {
          customer_id: customer.id,
          first_name: "Demo",
          last_name: options.lastName,
          address_1: options.address.address_1,
          city: options.address.city,
          province: options.address.state,
          postal_code: options.address.pin,
          country_code: "in",
          phone: options.phone,
          is_default_shipping: true,
        },
      ],
    },
  });
  return password;
};

const findPublishableKey = async (container: MedusaContainer) => {
  const { data } = await getQuery(container).graph({
    entity: "api_key",
    fields: ["id", "token"],
    filters: { type: "publishable" },
  });
  return (data[0]?.token as string | undefined) ?? null;
};

// Rows from an earlier run, by email, so a later run keeps passwords it cannot recover.
const previousRows = (text: string) => {
  const rows = new Map<string, string>();
  const start = text.indexOf(SEED_START);
  const end = text.indexOf(SEED_END);
  if (start === -1 || end <= start) return rows;
  for (const line of text.slice(start, end).split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length > 3 && cells[2].includes("@")) rows.set(cells[2], line);
  }
  return rows;
};

const accountRow = (account: Account, previous: Map<string, string>) => {
  if (account.password) {
    return `| ${account.role} | ${account.email} | ${account.password} | test-data-seed | ${RESET_TEXT} |`;
  }
  const old = previous.get(account.email);
  if (old && !old.includes("not recoverable")) return old;
  return `| ${account.role} | ${account.email} | existing account, password not recoverable | test-data-seed | ${RESET_TEXT} |`;
};

const buildBlock = (
  accounts: Account[],
  previous: Map<string, string>,
  fixtures: AddressFixture[],
  publishableKey: string | null,
) =>
  [
    "| Role | Email | Password | Created by | How to reset |",
    "|---|---|---|---|---|",
    ...accounts.map((account) => accountRow(account, previous)),
    "",
    "Demo addresses with valid state and PIN pairs",
    "",
    "| Label | State | City | PIN | Address line |",
    "|---|---|---|---|---|",
    ...fixtures.map(
      (item) => `| ${item.label} | ${item.state} | ${item.city} | ${item.pin} | ${item.address_1} |`,
    ),
    "",
    `Saved addresses: Demo Customer A uses ${fixtures[0].label}, Demo Customer B uses ${fixtures[1].label}.`,
    "",
    publishableKey
      ? `Publishable API key for NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: \`${publishableKey}\``
      : "Publishable API key: not found, create one in the Admin under Settings.",
  ].join("\n");

const replaceSeedBlock = (text: string, block: string) => {
  const start = text.indexOf(SEED_START);
  const end = text.indexOf(SEED_END);
  if (start !== -1 && end > start) {
    return `${text.slice(0, start + SEED_START.length)}\n${block}\n${text.slice(end)}`;
  }
  const heading = text.indexOf(ACCOUNTS_HEADING);
  const insertion = `${SEED_START}\n${block}\n${SEED_END}\n`;
  if (heading === -1) return `${text.trimEnd()}\n\n${ACCOUNTS_HEADING}\n\n${insertion}`;
  const lineEnd = text.indexOf("\n", heading);
  return `${text.slice(0, lineEnd + 1)}\n${insertion}${text.slice(lineEnd + 1)}`;
};

export default async function test_data_seed({
  container,
}: {
  container: MedusaContainer;
}) {
  // Medusa can run this folder during db:migrate, so only an explicit request seeds.
  if (process.env.TEST_DATA_SEED !== "1") return;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to create demo accounts in production. Dev demo credentials never go to production.",
    );
  }

  const root = findRepoRoot();
  assertIgnored(root);
  const fixtures = loadFixtures();

  const accounts: Account[] = [];

  await step(
    (async () => {
      accounts.push({
        role: "superadmin",
        email: "admin@example.test",
        password: await createAdmin(container, "admin@example.test"),
      });
    })(),
    "demo admin",
  );

  await step(
    (async () => {
      accounts.push({
        role: "customer",
        email: "customer-a@example.test",
        password: await createCustomer(container, {
          email: "customer-a@example.test",
          lastName: "Customer A",
          phone: "+919000000001",
          address: fixtures[0],
        }),
      });
      accounts.push({
        role: "customer",
        email: "customer-b@example.test",
        password: await createCustomer(container, {
          email: "customer-b@example.test",
          lastName: "Customer B",
          phone: "+919000000002",
          address: fixtures[1],
        }),
      });
    })(),
    "demo customers",
  );

  const publishableKey = await findPublishableKey(container);

  const filePath = path.join(root, FILE_NAME);
  const base = existsSync(filePath)
    ? readFileSync(filePath, "utf8")
    : readFileSync(path.join(root, TEMPLATE_PATH), "utf8");
  const block = buildBlock(accounts, previousRows(base), fixtures, publishableKey);
  writeFileSync(filePath, replaceSeedBlock(base, block));

  const created = accounts.filter((account) => account.password).length;
  logger.info(
    `[test-data-seed] created ${created} accounts, skipped ${accounts.length - created} existing accounts, wrote ${FILE_NAME}`,
  );
}
