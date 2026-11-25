import sharp from "sharp";
import type { MatrixEntry } from "./types";

// A small real image, built when the fixture runs. No binary is committed.
const smallJpeg = () =>
  sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 51, g: 102, b: 153 } } })
    .jpeg()
    .toBuffer();

// No id parameters: the route reads the owner from the session only, so the
// cross-vendor id check does not apply. Extra keys from the harness are sent as
// text fields next to the file, which the route refuses with a 400.
const entries: MatrixEntry[] = [
  {
    method: "POST",
    path: "/vendor/uploads",
    multipart: async () => ({
      field: "file",
      filename: "matrix.jpg",
      contentType: "image/jpeg",
      bytes: await smallJpeg(),
    }),
  },
];

export default entries;
