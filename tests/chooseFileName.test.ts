import { describe, test, expect } from "vitest";
import { chooseFileName } from "../src/contentProcessor";
import { md5Sig } from "../src/utils";
import { DEFAULT_SETTINGS, ISettings } from "../src/config";

// A PNG header so file-type detection resolves to "png".
const PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
];

function pngData(): ArrayBuffer {
  return new Uint8Array(PNG_BYTES).buffer;
}

function makeAdapter(existingPaths: Set<string>) {
  const calls = { exists: [] as string[], readBinary: [] as string[] };
  return {
    calls,
    async exists(p: string) {
      calls.exists.push(p);
      return existingPaths.has(p);
    },
    async readBinary(p: string) {
      calls.readBinary.push(p);
      return pngData();
    },
  };
}

function settings(overrides: Partial<ISettings> = {}): ISettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("chooseFileName", () => {
  test("new content gets an md5-based name and needWrite=true", async () => {
    const adapter = makeAdapter(new Set());
    const data = pngData();
    const expectedName = `media/${md5Sig(data)}.png`;

    const res = await chooseFileName(
      adapter as any,
      "media",
      "https://example.com/img.png",
      data,
      settings({ useSharding: false })
    );

    expect(res.fileName).toBe(expectedName);
    expect(res.needWrite).toBe(true);
  });

  test("existing file with same md5 name is reused WITHOUT reading it back", async () => {
    const data = pngData();
    const existing = `media/${md5Sig(data)}.png`;
    const adapter = makeAdapter(new Set([existing]));

    const res = await chooseFileName(
      adapter as any,
      "media",
      "https://example.com/img.png",
      data,
      settings({ useSharding: false })
    );

    expect(res.fileName).toBe(existing);
    expect(res.needWrite).toBe(false);
    // The whole point: content-addressed names make the read-back + re-hash redundant.
    expect(adapter.calls.readBinary).toEqual([]);
  });

  test("sharding places the file in a first-hash-char subfolder", async () => {
    const data = pngData();
    const hash = md5Sig(data);
    const shard = hash[0];
    const adapter = makeAdapter(new Set());

    const res = await chooseFileName(
      adapter as any,
      "media",
      "https://example.com/img.png",
      data,
      settings({ useSharding: true })
    );

    expect(res.fileName).toBe(`media/${shard}/${hash}.png`);
    expect(res.shardDir).toBe(`media/${shard}`);
  });

  test("ignored extensions are skipped", async () => {
    const adapter = makeAdapter(new Set());
    // "html" is in the default ignored list; html content has no magic bytes
    // so ext detection falls through to the link extension.
    const htmlData = new TextEncoder().encode("<p>hello</p>").buffer;

    const res = await chooseFileName(
      adapter as any,
      "media",
      "https://example.com/page.html",
      htmlData,
      settings({ useSharding: false })
    );

    expect(res.fileName).toBe("");
    expect(res.needWrite).toBe(false);
  });
});
