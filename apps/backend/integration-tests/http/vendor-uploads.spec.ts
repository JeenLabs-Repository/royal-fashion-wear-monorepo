import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import sharp from "sharp";
import { VENDOR_CATALOG_MODULE } from "../../src/modules/vendor-catalog";
import type VendorCatalogService from "../../src/modules/vendor-catalog/service";
import { suspendVendorWorkflow } from "../../src/workflows/vendors/suspend-vendor";
import { getVendorSession } from "../helpers/mfa";
import { createVendorFixture } from "../helpers/vendor-fixtures";
import { makeExifJpeg } from "../support/make-exif-image";

jest.setTimeout(300_000);

const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
// The local provider may put a timestamp in front and the S3 provider may add a 26-character suffix.
const KEY_PATTERN = new RegExp(`^products/(\\d+-)?${UUID_V4}(-[0-9A-Z]{26})?\\.webp$`);
const URL_PATTERN = new RegExp(`/products/(\\d+-)?${UUID_V4}(-[0-9A-Z]{26})?\\.webp$`);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const catalog = (): VendorCatalogService =>
      getContainer().resolve<VendorCatalogService>(VENDOR_CATALOG_MODULE);

    const makeVendor = async (
      label: string,
      options: { status?: "active" | "invited"; enrolled?: boolean; suspend?: boolean } = {}
    ) => {
      const fixture = await createVendorFixture(getContainer(), {
        label,
        status: options.status ?? "active",
        locations: [{ state_code: "IN-MH", pin: "400001" }],
      });
      const session = await getVendorSession(api, fixture, { enrolled: options.enrolled ?? true });
      if (options.suspend) {
        await suspendVendorWorkflow(getContainer()).run({
          input: {
            vendor_id: fixture.vendor_id,
            reason: "Suspended by the upload spec",
            actor: { id: "upload-spec" },
          },
        });
      }
      return { fixture, headers: session.headers };
    };

    // axios 1.20 sends FormData as multipart.
    const send = async (
      headers: Record<string, string>,
      build: (form: FormData) => void | Promise<void>
    ) => {
      const form = new FormData();
      await build(form);
      return api.post("/vendor/uploads", form, {
        headers,
        validateStatus: () => true,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    };

    const attach = (form: FormData, bytes: Buffer, filename: string, type: string, field = "file") =>
      form.append(field, new Blob([new Uint8Array(bytes)], { type }), filename);

    const normalise = (key: string) => key.replace(/\\/g, "/");

    // The stored file is read from the local upload folder; the public URL is the fallback.
    const readStored = async (key: string, url: string): Promise<Buffer> => {
      try {
        return await readFile(path.resolve(process.cwd(), "static", ...normalise(key).split("/")));
      } catch {
        const response = await fetch(url);
        return Buffer.from(await response.arrayBuffer());
      }
    };

    const uploadCanary = async (headers: Record<string, string>) =>
      send(headers, async (form) =>
        attach(
          form,
          await makeExifJpeg({ width: 4000, height: 3000, orientation: 1 }),
          "canary-vendor-photo.jpg",
          "image/jpeg"
        )
      );

    it("stores a clean WebP for a JPEG carrying GPS and a camera model", async () => {
      const { headers } = await makeVendor("upload-clean");
      const jpeg = await makeExifJpeg({ width: 4000, height: 3000, orientation: 1 });
      const response = await send(headers, (form) =>
        attach(form, jpeg, "canary-vendor-photo.jpg", "image/jpeg")
      );
      expect(response.status).toBe(200);
      expect(Object.keys(response.data)).toEqual(["upload"]);
      expect(Object.keys(response.data.upload).sort()).toEqual(["id", "url"]);

      const row = await catalog().retrieveVendorUpload(response.data.upload.id);
      const bytes = await readStored(row.file_key, response.data.upload.url);
      expect(bytes.toString("latin1", 0, 4)).toBe("RIFF");
      expect(bytes.toString("latin1", 8, 12)).toBe("WEBP");
      const metadata = await sharp(bytes).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(2000);
      for (const text of ["Exif", "GPS", "CanaryCam", "CANARY", "canary-vendor-photo"]) {
        expect(bytes.includes(Buffer.from(text, "latin1"))).toBe(false);
      }
    });

    it("stores under a random key with no owner id and no file name", async () => {
      const { fixture, headers } = await makeVendor("upload-key");
      const response = await send(headers, async (form) =>
        attach(form, await makeExifJpeg({ width: 600, height: 400 }), "canary-vendor-photo.jpg", "image/jpeg")
      );
      expect(response.status).toBe(200);
      const row = await catalog().retrieveVendorUpload(response.data.upload.id);
      expect(normalise(row.file_key)).toMatch(KEY_PATTERN);
      expect(new URL(response.data.upload.url).pathname).toMatch(URL_PATTERN);
      for (const text of [fixture.vendor_id, fixture.user_id, "canary", "vendor-photo"]) {
        expect(response.data.upload.url.toLowerCase()).not.toContain(text.toLowerCase());
        expect(row.file_key.toLowerCase()).not.toContain(text.toLowerCase());
      }
    });

    it("applies the camera orientation: 300 by 200 with orientation 6 is stored as 200 by 300", async () => {
      const { headers } = await makeVendor("upload-orientation");
      const response = await send(headers, async (form) =>
        attach(form, await makeExifJpeg({ width: 300, height: 200, orientation: 6 }), "photo.jpg", "image/jpeg")
      );
      expect(response.status).toBe(200);
      const row = await catalog().retrieveVendorUpload(response.data.upload.id);
      const metadata = await sharp(await readStored(row.file_key, response.data.upload.url)).metadata();
      expect({ width: metadata.width, height: metadata.height }).toEqual({ width: 200, height: 300 });
    });

    it("decides the type by bytes and refuses bad input with a code", async () => {
      const { headers } = await makeVendor("upload-types");

      const png = await sharp({
        create: { width: 40, height: 30, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .png()
        .toBuffer();
      const okPng = await send(headers, (form) => attach(form, png, "photo.jpg", "image/jpeg"));
      expect(okPng.status).toBe(200);
      const stored = await catalog().retrieveVendorUpload(okPng.data.upload.id);
      const storedBytes = await readStored(stored.file_key, okPng.data.upload.url);
      expect(storedBytes.toString("latin1", 8, 12)).toBe("WEBP");

      const text = await send(headers, (form) =>
        attach(form, Buffer.from("not an image"), "photo.jpg", "image/jpeg")
      );
      expect([text.status, text.data.code]).toEqual([400, "unsupported_type"]);

      const svg = await send(headers, (form) =>
        attach(form, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "logo.svg", "image/svg+xml")
      );
      expect([svg.status, svg.data.code]).toEqual([400, "unsupported_type"]);

      const gif = await send(headers, (form) =>
        attach(form, Buffer.from("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;", "latin1"), "a.gif", "image/gif")
      );
      expect(gif.status).toBe(400);

      const big = await send(headers, (form) =>
        attach(form, Buffer.alloc(9 * 1024 * 1024, 1), "big.jpg", "image/jpeg")
      );
      expect([big.status, big.data.code]).toEqual([400, "file_too_large"]);

      const twoFiles = await send(headers, (form) => {
        attach(form, png, "a.png", "image/png");
        attach(form, png, "b.png", "image/png");
      });
      expect([twoFiles.status, twoFiles.data.code]).toEqual([400, "unexpected_field"]);

      const extraField = await send(headers, (form) => {
        form.append("note", "hello");
        attach(form, png, "a.png", "image/png");
      });
      expect([extraField.status, extraField.data.code]).toEqual([400, "unexpected_field"]);

      const otherName = await send(headers, (form) => attach(form, png, "a.png", "image/png", "image"));
      expect([otherName.status, otherName.data.code]).toEqual([400, "unexpected_field"]);

      const noFile = await api.post("/vendor/uploads", {}, { headers, validateStatus: () => true });
      expect([noFile.status, noFile.data.code]).toEqual([400, "file_required"]);
    });

    it("refuses without a session before reading the body, and for suspended, unenrolled and invited vendors", async () => {
      const png = await sharp({
        create: { width: 40, height: 30, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .png()
        .toBuffer();

      const started = Date.now();
      const anonymous = await send({}, (form) =>
        attach(form, randomBytes(2 * 1024 * 1024), "big.jpg", "image/jpeg")
      );
      expect(anonymous.status).toBe(401);
      expect(Date.now() - started).toBeLessThan(1000);

      const suspended = await makeVendor("upload-suspended", { suspend: true });
      const refusedSuspended = await send(suspended.headers, (form) => attach(form, png, "a.png", "image/png"));
      expect([refusedSuspended.status, refusedSuspended.data.code]).toEqual([403, "vendor_suspended"]);

      const unenrolled = await makeVendor("upload-unenrolled", { enrolled: false });
      const refusedUnenrolled = await send(unenrolled.headers, (form) => attach(form, png, "a.png", "image/png"));
      expect([refusedUnenrolled.status, refusedUnenrolled.data.code]).toEqual([403, "mfa_enrollment_required"]);

      const invited = await makeVendor("upload-invited", { status: "invited" });
      const refusedInvited = await send(invited.headers, (form) => attach(form, png, "a.png", "image/png"));
      expect(refusedInvited.status).toBe(403);
      expect(refusedInvited.data.code).toBe("vendor_not_active");

      expect(await catalog().listVendorUploads({})).toHaveLength(0);
    });

    it("stops at 100 unattached uploads per vendor and leaves other vendors alone", async () => {
      const a = await makeVendor("upload-cap-a");
      const b = await makeVendor("upload-cap-b");
      await catalog().createVendorUploads(
        Array.from({ length: 100 }, (_, index) => ({
          vendor_id: a.fixture.vendor_id,
          file_key: `products/seed-${index}.webp`,
          url: `https://files.example.test/products/seed-${index}.webp`,
        }))
      );
      const png = await sharp({
        create: { width: 40, height: 30, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .png()
        .toBuffer();
      const refused = await send(a.headers, (form) => attach(form, png, "a.png", "image/png"));
      expect([refused.status, refused.data.code]).toEqual([409, "too_many_pending_uploads"]);

      const allowed = await send(b.headers, (form) => attach(form, png, "a.png", "image/png"));
      expect(allowed.status).toBe(200);
    });

    it("records the owner and leaves the product empty, invisible to other vendors", async () => {
      const a = await makeVendor("upload-owner-a");
      const b = await makeVendor("upload-owner-b");
      const response = await send(a.headers, async (form) =>
        attach(form, await makeExifJpeg({ width: 120, height: 80 }), "photo.jpg", "image/jpeg")
      );
      expect(response.status).toBe(200);
      const row = await catalog().retrieveVendorUpload(response.data.upload.id);
      expect(row.vendor_id).toBe(a.fixture.vendor_id);
      expect(row.product_id).toBeNull();
      const seenByB = await catalog().listVendorUploads({ vendor_id: b.fixture.vendor_id });
      expect(seenByB.map((upload) => upload.id)).not.toContain(row.id);
    });

    it("writes neither the original file name nor camera text to the logs", async () => {
      const { headers } = await makeVendor("upload-logs");
      const captured: string[] = [];
      const spies = ["log", "info", "warn", "error", "debug"].map((method) =>
        jest.spyOn(console, method as "log").mockImplementation((...args: unknown[]) => {
          captured.push(args.map(String).join(" "));
        })
      );
      const originalOut = process.stdout.write.bind(process.stdout);
      const originalErr = process.stderr.write.bind(process.stderr);
      const outSpy = jest.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        captured.push(String(chunk));
        return (originalOut as (...args: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stdout.write);
      const errSpy = jest.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        captured.push(String(chunk));
        return (originalErr as (...args: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stderr.write);
      const logger = getContainer().resolve(ContainerRegistrationKeys.LOGGER) as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      const loggerSpies = ["info", "warn", "error", "debug", "http"]
        .filter((method) => typeof logger[method] === "function")
        .map((method) =>
          jest.spyOn(logger, method).mockImplementation((...args: unknown[]) => {
            captured.push(args.map(String).join(" "));
          })
        );
      try {
        const response = await uploadCanary(headers);
        expect(response.status).toBe(200);
      } finally {
        for (const spy of [...spies, outSpy, errSpy, ...loggerSpies]) {
          spy.mockRestore();
        }
      }
      const output = captured.join("\n");
      expect(output).not.toContain("canary-vendor-photo");
      expect(output).not.toContain("CANARY");
      expect(output).not.toContain("CanaryCam");
    });
  },
});
