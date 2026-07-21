import { describe, test, expect } from "vitest";
import md5 from "crypto-js/md5";
import { md5Sig } from "../src/utils";

// Reference implementation — the plugin's historical crypto-js algorithm,
// copied verbatim from utils.ts as of v0.16.4. Existing vault attachments
// are NAMED by this hash, so the production md5Sig must match it exactly.
function legacyMd5Sig(contentData: ArrayBuffer): string {
  const dec = new TextDecoder("utf-8");
  const arrMid = Math.round(contentData.byteLength / 2);
  const chunk = 15000;
  const signature = md5(
    [
      contentData.slice(0, chunk),
      contentData.slice(arrMid, arrMid + chunk),
      contentData.slice(-chunk),
    ]
      .map((x) => dec.decode(x))
      .join()
  ).toString();
  return signature + "_MD5";
}

function buf(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe("md5Sig node-crypto implementation", () => {
  test("matches legacy output for small ascii content", () => {
    const data = buf([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]);
    expect(md5Sig(data)).toBe(legacyMd5Sig(data));
  });

  test("matches legacy output for binary content with invalid utf-8 bytes", () => {
    const bytes = [0xff, 0xfe, 0x00, 0x89, 0x50, 0x4e, 0x47, 0xc3, 0x28, 0xa0, 0xa1];
    const data = buf(bytes);
    expect(md5Sig(data)).toBe(legacyMd5Sig(data));
  });

  test("matches legacy output for content larger than the 15KB chunk window", () => {
    const bytes = new Uint8Array(60000);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 7 + 13) % 256;
    }
    const data = bytes.buffer;
    expect(md5Sig(data)).toBe(legacyMd5Sig(data));
  });

  test("matches legacy output for empty content", () => {
    const data = new ArrayBuffer(0);
    expect(md5Sig(data)).toBe(legacyMd5Sig(data));
  });

  test("keeps the _MD5 suffix convention", () => {
    const data = buf([1, 2, 3]);
    expect(md5Sig(data)).toMatch(/^[0-9a-f]{32}_MD5$/);
  });

  test("does not use crypto-js at runtime (node crypto produces same hash)", async () => {
    // Guard: the utils module must not import crypto-js anymore.
    const fs = await import("fs");
    const src = fs.readFileSync(new URL("../src/utils.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/from ["']crypto-js/);
    expect(src).not.toMatch(/require\(["']crypto-js/);
  });
});
