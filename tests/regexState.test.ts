import { describe, test, expect, beforeEach } from "vitest";

(globalThis as any).window = (globalThis as any).window ?? {
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms) as unknown as number,
  clearInterval: (id: number) => clearInterval(id),
};

import LocalImagesPlugin from "../src/main";
import { md5Sig, replaceAsync, anyPatternMatches } from "../src/utils";
import { MD_SEARCH_PATTERN } from "../src/config";
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
  note.path = "inbox/Note.md";
  note.basename = "Note";
  note.parent = { path: "inbox", name: "inbox", children: [] } as any;
  return note;
}

function makeEnv(initialContent: string) {
  const env: any = { content: initialContent, app: null };
  env.app = {
    vault: {
      getConfig: (key: string) => {
        if (key === "attachmentFolderPath") return "media";
        if (key === "useMarkdownLinks") return false;
        return undefined;
      },
      adapter: {
        basePath: "/fake/vault",
        exists: async (_p: string) => false,
      },
      createBinary: async (_p: string, _d: ArrayBuffer) => {},
      createFolder: async (_p: string) => {},
      cachedRead: async (_f: TFile) => env.content,
      modify: async (_f: TFile, data: string) => {
        env.content = data;
      },
      process: async (_f: TFile, fn: (data: string) => string) => {
        env.content = fn(env.content);
        return env.content;
      },
      on: () => ({}),
    },
    workspace: {
      on: () => ({}),
      onLayoutReady: (_cb: () => void) => {},
    },
  };
  return env;
}

function noteWithManyImages(count: number): string {
  let out = "# T\n\n";
  for (let i = 0; i < count; i++) {
    out += `Paragraph ${i}.\n\n![](https://example.com/img${i}.png)\n\n`;
  }
  return out;
}

beforeEach(() => {
  setRequestUrlImpl(async () => ({ arrayBuffer: pngData() }));
  // Tests must not depend on incidental regex state left by other tests.
  for (const p of MD_SEARCH_PATTERN) p.lastIndex = 0;
});

describe("shared regex lastIndex state", () => {
  test("replaceAsync finds all tags even after .test() polluted the shared patterns", async () => {
    const content = noteWithManyImages(10);

    // processMdFilesOnTimer and onPasteFunc call .test() on the shared /g
    // pattern constants; .test() advances lastIndex, and matchAll clones
    // inherit it — silently skipping every match before that offset.
    for (const p of MD_SEARCH_PATTERN) p.test(content);

    const results: string[] = [];
    const fixed = await replaceAsync(content, MD_SEARCH_PATTERN, async (match: string) => {
      results.push(match);
      return null;
    });

    // All 10 image tags must be seen, regardless of prior regex state.
    expect(results.length).toBe(10);
    expect(fixed[0]).toBe(content);
  });

  test("processPage localizes every link after timer-style .test() pollution", async () => {
    const env = makeEnv(noteWithManyImages(6));
    const plugin = new LocalImagesPlugin(env.app, {} as any);
    await plugin.loadSettings();
    (plugin as any).settings.showNotifications = false;
    (plugin as any).settings.useSharding = true;

    for (const p of MD_SEARCH_PATTERN) p.test(env.content);

    await (plugin as any).processPage(makeNote(), false);

    expect(env.content).not.toContain("](https://");
    const hash = md5Sig(pngData());
    expect(env.content).toContain(`![[media/${hash[0]}/${hash}.png]]`);
  });

  test("anyPatternMatches detects matches and leaves the patterns clean", async () => {
    const content = noteWithManyImages(3);
    expect(anyPatternMatches(MD_SEARCH_PATTERN, content)).toBe(true);
    for (const p of MD_SEARCH_PATTERN) {
      expect(p.lastIndex).toBe(0);
    }
    expect(anyPatternMatches(MD_SEARCH_PATTERN, "no links here")).toBe(false);
    // Detection must not be state-dependent: repeat calls agree.
    expect(anyPatternMatches(MD_SEARCH_PATTERN, content)).toBe(true);
  });
});
