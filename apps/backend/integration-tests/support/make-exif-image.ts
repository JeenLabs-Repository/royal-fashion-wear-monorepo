import sharp from "sharp";

// Builds a JPEG that carries a camera make and model, an orientation and GPS
// coordinates, so a test can prove none of it survives processing. The EXIF
// block is written by hand (little-endian TIFF inside an APP1 segment), so the
// result does not depend on how an installed sharp version writes EXIF.
// No binary file is committed.

type Entry = { tag: number; type: number; count: number; data: Buffer };

const u16 = (value: number): Buffer => {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
};

const u32 = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
};

const ascii = (text: string): Buffer => Buffer.from(`${text}\0`, "latin1");

const rationals = (...pairs: [number, number][]): Buffer =>
  Buffer.concat(pairs.map(([numerator, denominator]) => Buffer.concat([u32(numerator), u32(denominator)])));

// One directory: entry count, the entries, a zero link to a next directory,
// then the values that do not fit in four bytes. `offset` is where this
// directory starts, counted from the start of the TIFF header.
function buildIfd(entries: Entry[], offset: number): Buffer {
  const head = 2 + entries.length * 12 + 4;
  const table: Buffer[] = [u16(entries.length)];
  const extra: Buffer[] = [];
  let extraSize = 0;
  for (const entry of entries) {
    let valueField: Buffer;
    if (entry.data.length <= 4) {
      valueField = Buffer.concat([entry.data, Buffer.alloc(4 - entry.data.length)]);
    } else {
      valueField = u32(offset + head + extraSize);
      const padded =
        entry.data.length % 2 === 1 ? Buffer.concat([entry.data, Buffer.alloc(1)]) : entry.data;
      extra.push(padded);
      extraSize += padded.length;
    }
    table.push(u16(entry.tag), u16(entry.type), u32(entry.count), valueField);
  }
  table.push(u32(0));
  return Buffer.concat([...table, ...extra]);
}

function buildTiff(orientation: number): Buffer {
  const gps: Entry[] = [
    { tag: 0x0001, type: 2, count: 2, data: ascii("N") },
    { tag: 0x0002, type: 5, count: 3, data: rationals([12, 1], [58, 1], [48, 1]) },
    { tag: 0x0003, type: 2, count: 2, data: ascii("E") },
    { tag: 0x0004, type: 5, count: 3, data: rationals([77, 1], [35, 1], [12, 1]) },
    // Undefined type: an 8-byte character code header, then text that contains the letters GPS.
    {
      tag: 0x001b,
      type: 7,
      count: 11,
      data: Buffer.concat([Buffer.from("ASCII\0\0\0", "latin1"), Buffer.from("GPS", "latin1")]),
    },
  ];
  const ifd0 = (gpsOffset: number): Entry[] => [
    { tag: 0x010f, type: 2, count: 10, data: ascii("CanaryCam") },
    { tag: 0x0110, type: 2, count: 12, data: ascii("CANARY-9000") },
    { tag: 0x0112, type: 3, count: 1, data: u16(orientation) },
    { tag: 0x8825, type: 4, count: 1, data: u32(gpsOffset) },
  ];
  const ifd0Length = buildIfd(ifd0(0), 8).length;
  const gpsOffset = 8 + ifd0Length;
  return Buffer.concat([
    Buffer.from("II*\0", "latin1"),
    u32(8),
    buildIfd(ifd0(gpsOffset), 8),
    buildIfd(gps, gpsOffset),
  ]);
}

function injectExif(jpeg: Buffer, tiff: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([
    jpeg.subarray(0, 2),
    Buffer.from([0xff, 0xe1]),
    length,
    payload,
    jpeg.subarray(2),
  ]);
}

/** A solid-colour JPEG with a camera make and model, GPS coordinates and the given orientation (1 to 8). */
export async function makeExifJpeg(options: {
  width: number;
  height: number;
  orientation?: number;
}): Promise<Buffer> {
  const base = await sharp({
    create: {
      width: options.width,
      height: options.height,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  return injectExif(base, buildTiff(options.orientation ?? 1));
}
