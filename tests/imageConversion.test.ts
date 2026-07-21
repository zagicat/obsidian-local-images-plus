import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { blobToJpegArrayBuffer } from "../src/utils";

// Node has no image codecs, so the browser primitives are stubbed. What we
// verify is the wiring: async bitmap path, conversion parameters, error
// handling that resolves null instead of hanging forever.

const origCreateImageBitmap = (globalThis as any).createImageBitmap;
const origOffscreenCanvas = (globalThis as any).OffscreenCanvas;

let convertCalls: Array<{ type: string; quality: number }> = [];
let bitmapClosed = false;

class FakeOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(_kind: string) {
    return {
      fillStyle: "",
      fillRect: () => {},
      drawImage: () => {},
    };
  }
  async convertToBlob(opts: { type: string; quality: number }) {
    convertCalls.push(opts);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    return new Blob([bytes]);
  }
}

beforeEach(() => {
  convertCalls = [];
  bitmapClosed = false;
  (globalThis as any).OffscreenCanvas = FakeOffscreenCanvas;
  (globalThis as any).createImageBitmap = async (_blob: Blob) => ({
    width: 10,
    height: 8,
    close: () => {
      bitmapClosed = true;
    },
  });
});

afterEach(() => {
  (globalThis as any).createImageBitmap = origCreateImageBitmap;
  (globalThis as any).OffscreenCanvas = origOffscreenCanvas;
});

describe("blobToJpegArrayBuffer", () => {
  test("converts via OffscreenCanvas and resolves an ArrayBuffer", async () => {
    const blob = new Blob([new Uint8Array([9, 9, 9])]);
    const result = await blobToJpegArrayBuffer(blob, 0.8, "image/webp");

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(convertCalls).toEqual([{ type: "image/webp", quality: 0.8 }]);
  });

  test("releases the bitmap after conversion", async () => {
    const blob = new Blob([new Uint8Array([9])]);
    await blobToJpegArrayBuffer(blob, 0.8, "image/jpeg");
    expect(bitmapClosed).toBe(true);
  });

  test("resolves null instead of hanging when the image cannot be decoded", async () => {
    (globalThis as any).createImageBitmap = async () => {
      throw new Error("The source image could not be decoded.");
    };
    const blob = new Blob([new Uint8Array([0, 0])]);

    const result = await Promise.race([
      blobToJpegArrayBuffer(blob, 0.8, "image/webp"),
      new Promise((r) => setTimeout(() => r("TIMED_OUT"), 500)),
    ]);

    expect(result).toBeNull();
  });

  test("does not use FileReader, data URLs, or synchronous toDataURL", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(new URL("../src/utils.ts", import.meta.url), "utf-8");
    const fnStart = src.indexOf("export async function blobToJpegArrayBuffer");
    expect(fnStart).toBeGreaterThan(-1);
    const fnSrc = src.slice(fnStart);
    expect(fnSrc).not.toContain("FileReader");
    expect(fnSrc).not.toContain("toDataURL");
    expect(fnSrc).not.toContain("readAsDataURL");
  });
});
