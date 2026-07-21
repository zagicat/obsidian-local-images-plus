import { describe, test, expect, beforeEach } from "vitest";

(globalThis as any).window = (globalThis as any).window ?? {
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms) as unknown as number,
  clearInterval: (id: number) => clearInterval(id),
};

import LocalImagesPlugin from "../src/main";
import { md5Sig } from "../src/utils";
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

interface FakeVaultEnv {
  content: string;
  modifyCalls: number;
  processCalls: number;
  app: any;
}

function makeEnv(initialContent: string): FakeVaultEnv {
  const env: FakeVaultEnv = {
    content: initialContent,
    modifyCalls: 0,
    processCalls: 0,
    app: null,
  };

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
        env.modifyCalls++;
        env.content = data;
      },
      process: async (_f: TFile, fn: (data: string) => string) => {
        env.processCalls++;
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

async function makePlugin(env: FakeVaultEnv): Promise<LocalImagesPlugin> {
  const plugin = new LocalImagesPlugin(env.app, {} as any);
  await plugin.loadSettings();
  (plugin as any).settings.showNotifications = false;
  (plugin as any).settings.useSharding = true;
  return plugin;
}

beforeEach(() => {
  setRequestUrlImpl(async () => ({ arrayBuffer: pngData() }));
});

describe("processPage atomicity", () => {
  test("applies replacements through vault.process, not vault.modify", async () => {
    const env = makeEnv(`# T\n\n![alt](https://example.com/cat.png)\n`);
    const plugin = await makePlugin(env);

    await (plugin as any).processPage(makeNote(), false);

    expect(env.processCalls).toBeGreaterThan(0);
    expect(env.modifyCalls).toBe(0);
    const hash = md5Sig(pngData());
    expect(env.content).toContain(`![[media/${hash[0]}/${hash}.png]]`);
  });

  test("concurrent edits made during download are not lost", async () => {
    const env = makeEnv(`![alt](https://example.com/cat.png)\n`);
    const plugin = await makePlugin(env);

    // Simulate another writer (user / Smart Connections) appending while
    // the download is in flight: the fetch resolves only after the note
    // content has been changed under the plugin's feet.
    setRequestUrlImpl(async () => {
      env.content = env.content + "\nUser added this line mid-download.\n";
      return { arrayBuffer: pngData() };
    });

    await (plugin as any).processPage(makeNote(), false);

    const hash = md5Sig(pngData());
    expect(env.content).toContain(`![[media/${hash[0]}/${hash}.png]]`);
    // The concurrently added line must survive.
    expect(env.content).toContain("User added this line mid-download.");
  });
});
