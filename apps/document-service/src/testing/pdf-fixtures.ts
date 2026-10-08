import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
// Small real PDF documents, including Type0/ToUnicode Vietnamese text. No external fixture downloads.
export function textPdf(
  pages: readonly string[],
  compressed = false,
): Uint8Array {
  const objects: Buffer[] = [];
  const add = (value: string | Buffer) =>
    objects.push(
      typeof value === "string" ? Buffer.from(value, "binary") : value,
    );
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${7 + i * 2} 0 R`).join(" ")}] >>`,
  );
  add(
    "<< /Type /Font /Subtype /Type0 /BaseFont /Fixture /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>",
  );
  add(
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Fixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 500 >>",
  );
  add(
    "<< /Type /FontDescriptor /FontName /Fixture /Flags 32 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>",
  );
  const cmap =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Fixture def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end";
  add(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
  for (const text of pages) {
    const pageObject = objects.length + 1;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject + 1} 0 R >>`,
    );
    const lines = text.split("\n").map((line) =>
      Array.from(line)
        .map((c) => c.charCodeAt(0).toString(16).padStart(4, "0"))
        .join(""),
    );
    const content = Buffer.from(
      `BT /F1 12 Tf 72 720 Td ${lines.map((hex, index) => `${index ? "0 -14 Td " : ""}<${hex}> Tj`).join(" ")} ET`,
    );
    const bytes = compressed ? deflateSync(content) : content;
    add(
      Buffer.concat([
        Buffer.from(
          `<< /Length ${bytes.length}${compressed ? " /Filter /FlateDecode" : ""} >>\nstream\n`,
        ),
        bytes,
        Buffer.from("\nendstream"),
      ]),
    );
  }
  return serialize(objects);
}
function serialize(objects: Buffer[], trailer = ""): Uint8Array {
  let output = Buffer.from("%PDF-1.7\n");
  const offsets = [0];
  objects.forEach((value, i) => {
    offsets.push(output.length);
    output = Buffer.concat([
      output,
      Buffer.from(`${i + 1} 0 obj\n`),
      value,
      Buffer.from("\nendobj\n"),
    ]);
  });
  const start = output.length;
  return Buffer.concat([
    output,
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer} >>\nstartxref\n${start}\n%%EOF`,
    ),
  ]);
}
// Standard Security Handler revision 2 (40-bit RC4), including an empty-user-password variant.
const padding = Buffer.from(
  "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
  "hex",
);
function padded(password: string) {
  return Buffer.concat([Buffer.from(password), padding]).subarray(0, 32);
}
function md5(bytes: Uint8Array) {
  return createHash("md5").update(bytes).digest();
}
function rc4(key: Uint8Array, input: Uint8Array) {
  const state = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) % 256;
    [state[i], state[j]] = [state[j], state[i]];
  }
  let i = 0;
  j = 0;
  return Buffer.from(
    Array.from(input, (value) => {
      i = (i + 1) % 256;
      j = (j + state[i]) % 256;
      [state[i], state[j]] = [state[j], state[i]];
      return value ^ state[(state[i] + state[j]) % 256];
    }),
  );
}
export function encryptedPdf(password = "secret"): Uint8Array {
  const id = Buffer.alloc(16, 7),
    owner = rc4(md5(padded("owner")).subarray(0, 5), padded(password));
  const permission = Buffer.alloc(4);
  permission.writeInt32LE(-4);
  const key = md5(
    Buffer.concat([padded(password), owner, permission, id]),
  ).subarray(0, 5);
  const user = rc4(key, padding);
  return serialize(
    [
      Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
      Buffer.from("<< /Type /Pages /Count 1 /Kids [3 0 R] >>"),
      Buffer.from(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>",
      ),
      Buffer.from(
        `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`,
      ),
    ],
    `/Encrypt 4 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>]`,
  );
}
export function imageOnlyPdf(): Uint8Array {
  const stream = Buffer.from("q 100 0 0 100 72 600 cm /Im1 Do Q");
  return serialize([
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Count 1 /Kids [3 0 R] >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from("\nendstream"),
    ]),
    Buffer.concat([
      Buffer.from(
        "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\n",
      ),
      Buffer.from([0, 0, 0]),
      Buffer.from("\nendstream"),
    ]),
  ]);
}
