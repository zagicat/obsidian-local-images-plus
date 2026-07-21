import { describe, test, expect, beforeEach } from "vitest";
import { imageTagProcessor } from "../src/contentProcessor";
import { replaceAsync, md5Sig } from "../src/utils";
import { DEFAULT_SETTINGS, ISettings, MD_SEARCH_PATTERN } from "../src/config";
import { setRequestUrlImpl, TFile } from "obsidian";

const PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
];

function pngData(): ArrayBuffer {
  return new Uint8Array(PNG_BYTES).buffer;
}

function makeNote(): TFile {
  const note = new TFile();
  note.path = "inbox/Test Note.md";
  note.basename = "Test Note";
  note.parent = { path: "inbox", name: "inbox", children: [] } as any;
  return note;
}

interface FakeEnv {
  plugin: any;
  writes: Array<{ path: string; bytes: number }>;
  existing: Set<string>;
  failWritesWith?: string;
}

function makeFakePlugin(): FakeEnv {
  const writes: Array<{ path: string; bytes: number }> = [];
  const existing = new Set<string>();
  const env: FakeEnv = { plugin: null, writes, existing };

  const vault = {
    getConfig: (key: string) => {
      if (key === "attachmentFolderPath") return "media";
      if (key === "useMarkdownLinks") return false;
      return undefined;
    },
    adapter: {
      basePath: "/fake/vault",
      exists: async (p: string) => existing.has(p),
      readBinary: async (_p: string) => pngData(),
    },
    createBinary: async (p: string, data: ArrayBuffer) => {
      if (env.failWritesWith) throw new Error(env.failWritesWith);
      if (existing.has(p)) throw new Error("File already exists.");
      existing.add(p);
      writes.push({ path: p, bytes: data.byteLength });
    },
  };

  env.plugin = {
    app: { vault },
    ensureFolderExists: async (_p: string) => {},
  };
  return env;
}

function settings(overrides: Partial<ISettings> = {}): ISettings {
  return { ...DEFAULT_SETTINGS, ...overrides, showNotifications: false };
}

let requests: string[] = [];

beforeEach(() => {
  requests = [];
  setRequestUrlImpl(async ({ url }) => {
    requests.push(url);
    return { arrayBuffer: pngData() };
  });
});

describe("processImageTag via replaceAsync", () => {
  test("replaces a remote image tag with a local embed and writes the file once", async () => {
    const env = makeFakePlugin();
    const s = settings({ useSharding: true });
    const hash = md5Sig(pngData());
    const shard = hash[0];

    const content = `# Note\n\n![alt text](https://example.com/cat.png)\n`;
    const processor = imageTagProcessor(env.plugin, makeNote(), s, false);
    const [result, errorFlag] = await replaceAsync(content, MD_SEARCH_PATTERN, processor);

    expect(requests).toHaveLength(1);
    expect(env.writes).toHaveLength(1);
    expect(env.writes[0].path).toBe(`media/${shard}/${hash}.png`);
    expect(result).toContain(`![[media/${shard}/${hash}.png]]`);
    expect(result).not.toContain("https://example.com/cat.png");
    expect(errorFlag).toBe(false);
  });

  test("the same URL in two different tags downloads only once", async () => {
    const env = makeFakePlugin();
    const s = settings({ useSharding: true });

    const content =
      `![first](https://example.com/cat.png)\n` +
      `some text\n` +
      `![second](https://example.com/cat.png)\n`;
    const processor = imageTagProcessor(env.plugin, makeNote(), s, false);
    const [result, errorFlag] = await replaceAsync(content, MD_SEARCH_PATTERN, processor);

    expect(requests).toHaveLength(1);
    expect(env.writes).toHaveLength(1);
    expect(result).not.toContain("https://example.com/cat.png");
    expect(errorFlag).toBe(false);
  });

  test("a write colliding with an existing identical file still produces the local link", async () => {
    const env = makeFakePlugin();
    const s = settings({ useSharding: true });
    const hash = md5Sig(pngData());
    const shard = hash[0];
    // Simulate the race: file appears between the exists() check and createBinary.
    // chooseFileName sees it as absent, createBinary then throws.
    const target = `media/${shard}/${hash}.png`;
    const vault = env.plugin.app.vault;
    const originalCreate = vault.createBinary;
    vault.createBinary = async (_p: string, _d: ArrayBuffer) => {
      vault.createBinary = originalCreate;
      throw new Error("File already exists.");
    };

    const content = `![alt](https://example.com/cat.png)\n`;
    const processor = imageTagProcessor(env.plugin, makeNote(), s, false);
    const [result, errorFlag] = await replaceAsync(content, MD_SEARCH_PATTERN, processor);

    // Content-addressed name ⇒ existing file is identical ⇒ success, not failure.
    expect(result).toContain(`![[${target}]]`);
    expect(result).not.toContain("https://example.com/cat.png");
    expect(errorFlag).toBe(false);
  });

  test("bare filename mode produces ![[<name>.<ext>]] with no directory path", async () => {
    const env = makeFakePlugin();
    const s = settings({ useSharding: true, pathInTags: "baseFileName" });
    const hash = md5Sig(pngData());

    const content = `![alt](https://example.com/cat.png)\n`;
    const processor = imageTagProcessor(env.plugin, makeNote(), s, false);
    const [result] = await replaceAsync(content, MD_SEARCH_PATTERN, processor);

    expect(result).toContain(`![[${hash}.png]]`);
    expect(result).not.toContain(`media/`);
  });
});

describe("replaceAsync concurrency", () => {
  test("processes tags with bounded concurrency", async () => {
    let running = 0;
    let peak = 0;
    const tags: string[] = [];
    for (let i = 0; i < 10; i++) {
      tags.push(`![img${i}](https://example.com/img${i}.png)`);
    }
    const content = tags.join("\n");

    const trackingFn = async (match: string) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return [match, "REPLACED", ""];
    };

    await replaceAsync(content, MD_SEARCH_PATTERN, trackingFn);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
