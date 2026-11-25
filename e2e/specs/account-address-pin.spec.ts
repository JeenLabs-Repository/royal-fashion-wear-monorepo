import { randomBytes } from "node:crypto"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { appendCredentialEntry } from "../support/credentials-log"

const FLOW = "account-address-pin"

function logValues(what: string, values: string) {
  appendCredentialEntry({
    section: "Form values",
    what,
    flow: FLOW,
    reset: "Nothing to reset, the customer is test data",
    values,
  })
}

async function registerCustomer(page: Page, projectName: string) {
  const email = `pin-${Date.now()}-${projectName}@example.test`
  const password = `Pw-${randomBytes(9).toString("hex")}`

  // Record the account before using it, so a failed run still leaves it listed.
  appendCredentialEntry({
    section: "Accounts by role",
    what: `Customer ${email}`,
    flow: FLOW,
    reset: "Delete the customer in the admin dashboard, or leave it as test data",
    values: `${email} / ${password}`,
  })

  await page.goto("/en/account")
  // On the sign-in view this button opens the registration view.
  await page.getByTestId("register-button").click()
  await expect(page.getByTestId("register-page")).toBeVisible()
  await page.getByTestId("first-name-input").fill("Pin")
  await page.getByTestId("last-name-input").fill("Tester")
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("phone-input").fill("9876543210")
  await page.getByTestId("password-input").fill(password)
  // On the registration view the same test id is the submit button.
  await page.getByTestId("register-button").click()
  await expect(page.getByTestId("account-page")).toBeVisible()
  await expect(page.getByTestId("register-page")).toBeHidden()
}

async function save(dialog: Locator) {
  const button = dialog.getByTestId("save-button")
  // The dialog scrolls on a phone, so bring the button into view first.
  await button.scrollIntoViewIfNeeded()
  await button.click()
}

test("account addresses use the India fields and the server rule", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)

  await registerCustomer(page, testInfo.project.name)
  await page.goto("/en/account/addresses")

  const add = page.getByTestId("add-address-modal")
  const edit = page.getByTestId("edit-address-modal")
  const cards = page.getByTestId("address-container")

  // 1. Add with a known PIN: state and city fill in.
  logValues("Add, known PIN", "name Home, pin 560001, street 5 Test Road")
  await page.getByTestId("add-address-button").click()
  await expect(add).toBeVisible()
  await add.getByTestId("addres-name-input").fill("Home")
  await add.getByTestId("shipping-pin-input").fill("560001")
  await expect(add.getByTestId("shipping-state-select")).toHaveValue("in-ka", {
    timeout: 5000,
  })
  await expect(add.getByTestId("shipping-city-input")).not.toHaveValue("")
  await add.getByTestId("shipping-address-input").fill("5 Test Road")
  await save(add)
  await expect(add).toBeHidden()
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText("Home")

  // 2. Edit to a PIN of another state: the server rejects and the dialog stays.
  logValues(
    "Edit, PIN and state mismatch",
    "pin 110001 with state Karnataka, then Delhi"
  )
  await page.getByTestId("address-edit-button").click()
  await expect(edit).toBeVisible()
  await edit.getByTestId("shipping-pin-input").fill("110001")
  // The lookup moves the state to Delhi; choose Karnataka again on purpose.
  await expect(edit.getByTestId("shipping-state-select")).toHaveValue("in-dl", {
    timeout: 5000,
  })
  await edit.getByTestId("shipping-state-select").selectOption("in-ka")
  await save(edit)
  await expect(edit.getByTestId("address-error")).toContainText("another state")
  await expect(edit).toBeVisible()

  await edit.getByTestId("shipping-state-select").selectOption("in-dl")
  await save(edit)
  await expect(edit).toBeHidden()
  await expect(cards.first()).toContainText("110001")

  // 3. Add with an unknown PIN: accepted with the state and city typed by hand.
  logValues(
    "Add, unknown PIN",
    "name Other, pin 999998, state Maharashtra, city Testville"
  )
  await page.getByTestId("add-address-button").click()
  await expect(add).toBeVisible()
  await add.getByTestId("addres-name-input").fill("Other")
  await add.getByTestId("shipping-pin-input").fill("999998")
  await expect(add.getByTestId("pin-hint")).toContainText("could not verify")
  await add.getByTestId("shipping-state-select").selectOption("in-mh")
  await add.getByTestId("shipping-city-input").fill("Testville")
  await add.getByTestId("shipping-address-input").fill("9 Test Street")
  await save(add)
  await expect(add).toBeHidden()
  await expect(cards).toHaveCount(2)

  // 4. A phone number the server refuses shows an error and keeps the dialog open.
  logValues("Add, bad phone", "name Phone test, pin 400001, phone 12345")
  await page.getByTestId("add-address-button").click()
  await expect(add).toBeVisible()
  await add.getByTestId("addres-name-input").fill("Phone test")
  await add.getByTestId("shipping-pin-input").fill("400001")
  await expect(add.getByTestId("shipping-state-select")).toHaveValue("in-mh", {
    timeout: 5000,
  })
  await add.getByTestId("shipping-address-input").fill("1 Test Lane")
  await add.getByTestId("phone-input").fill("12345")
  await save(add)
  await expect(add.getByTestId("address-error")).toContainText("10-digit")
  await expect(add).toBeVisible()
})
