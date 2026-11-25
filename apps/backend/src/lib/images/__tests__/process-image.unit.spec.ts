import { MedusaError } from "@medusajs/framework/utils";
import sharp from "sharp";
import { makeExifJpeg } from "../../../../integration-tests/support/make-exif-image";
import { detectImageType, processImage } from "../process-image";

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 10, g: 80, b: 200 } } });

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MedusaError);
    expect((error as MedusaError).type).toBe(MedusaError.Types.INVALID_DATA);
    return (error as MedusaError).code;
  }
  return undefined;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Only the parts the animation check reads. The decoder never sees these bytes.
const animatedPngStub = (): Buffer =>
  Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", Buffer.alloc(13)),
    chunk("acTL", Buffer.alloc(8)),
    chunk("IDAT", Buffer.alloc(4)),
  ]);

const animatedWebpStub = (): Buffer => {
  const header = Buffer.alloc(30);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(22, 4);
  header.write("WEBP", 8, "latin1");
  header.write("VP8X", 12, "latin1");
  header.writeUInt32LE(10, 16);
  header[20] = 0x02;
  return header;
};

describe("detectImageType", () => {
  it("recognises JPEG, PNG and WebP by their first bytes", async () => {
    expect(detectImageType(await solid(8, 8).jpeg().toBuffer())).toBe("jpeg");
    expect(detectImageType(await solid(8, 8).png().toBuffer())).toBe("png");
    expect(detectImageType(await solid(8, 8).webp().toBuffer())).toBe("webp");
  });

  it("returns null for GIF, SVG, HEIC, AVIF, plain text and an empty buffer", () => {
    const samples = [
      Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "latin1"),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      Buffer.from("\u0000\u0000\u0000\u0018ftypheic", "latin1"),
      Buffer.from("\u0000\u0000\u0000 ftypavif", "latin1"),
      Buffer.from("just some text"),
      Buffer.alloc(0),
    ];
    for (const sample of samples) {
      expect(detectImageType(sample)).toBeNull();
    }
  });
});

describe("processImage", () => {
  it("sets one decoder thread", () => {
    expect(sharp.concurrency()).toBe(1);
  });

  it("turns a 4000 by 3000 JPEG into a 2000 by 1500 WebP", async () => {
    const result = await processImage(await solid(4000, 3000).jpeg().toBuffer());
    expect(result.format).toBe("webp");
    expect(result.data.toString("latin1", 0, 4)).toBe("RIFF");
    expect(result.data.toString("latin1", 8, 12)).toBe("WEBP");
    expect({ width: result.width, height: result.height }).toEqual({ width: 2000, height: 1500 });
  });

  it("does not enlarge a small image", async () => {
    const result = await processImage(await solid(300, 200).jpeg().toBuffer());
    expect({ width: result.width, height: result.height }).toEqual({ width: 300, height: 200 });
  });

  it("applies the camera orientation: 300 by 200 with orientation 6 becomes 200 by 300", async () => {
    const result = await processImage(await makeExifJpeg({ width: 300, height: 200, orientation: 6 }));
    expect({ width: result.width, height: result.height }).toEqual({ width: 200, height: 300 });
  });

  it("the test helper writes the metadata it claims to", async () => {
    const input = await makeExifJpeg({ width: 300, height: 200, orientation: 6 });
    const metadata = await sharp(input).metadata();
    expect(metadata.orientation).toBe(6);
    for (const text of ["Exif", "CanaryCam", "CANARY-9000", "GPS"]) {
      expect(input.includes(Buffer.from(text, "latin1"))).toBe(true);
    }
  });

  it("drops all metadata: no EXIF, XMP or ICC, and no camera text in the bytes", async () => {
    const input = await makeExifJpeg({ width: 600, height: 400, orientation: 3 });
    const { data } = await processImage(input);
    const metadata = await sharp(data).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    for (const text of ["Exif", "GPS", "CanaryCam", "CANARY"]) {
      expect(data.includes(Buffer.from(text, "latin1"))).toBe(false);
    }
  });

  it("accepts a still PNG with transparency", async () => {
    const png = await sharp({
      create: { width: 50, height: 40, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } },
    })
      .png()
      .toBuffer();
    const result = await processImage(png);
    expect({ width: result.width, height: result.height }).toEqual({ width: 50, height: 40 });
  });

  it("rejects GIF as unsupported_type", async () => {
    expect(await codeOf(processImage(Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "latin1")))).toBe(
      "unsupported_type"
    );
  });

  it("rejects SVG and text as unsupported_type whatever they are called", async () => {
    expect(await codeOf(processImage(Buffer.from("<svg></svg>")))).toBe("unsupported_type");
    expect(await codeOf(processImage(Buffer.from("photo.jpg")))).toBe("unsupported_type");
  });

  it("rejects an animated PNG (acTL chunk) and an animated WebP (animation flag)", async () => {
    expect(await codeOf(processImage(animatedPngStub()))).toBe("animated_image");
    expect(await codeOf(processImage(animatedWebpStub()))).toBe("animated_image");
  });

  it("rejects an image over the pixel limit it is given", async () => {
    const input = await solid(300, 200).jpeg().toBuffer();
    expect(await codeOf(processImage(input, { limitInputPixels: 1000 }))).toBe("image_pixels_exceeded");
  });

  it("rejects bytes that only look like a JPEG as corrupt_image", async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    expect(await codeOf(processImage(bytes))).toBe("corrupt_image");
  });
});
