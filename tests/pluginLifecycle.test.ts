import { describe, test, expect, beforeEach } from "vitest";

// The plugin uses window.setInterval / window.clearInterval; provide a
// minimal shim before importing it (node test env has no window).
(globalThis as any).window = {
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms) as unknown as number,
  clearInterval: (id: number) => clearInterval(id),
};

import LocalImagesPlugin from "../src/main";

interface FakeApp {
  layoutReadyCallbacks: Array<() => void>;
  vaultOnCalls: string[];
  workspaceOnCalls: string[];
  fireLayoutReady: () => void;
  [key: string]: any;
}

function makeFakeApp(): FakeApp {
  const layoutReadyCallbacks: Array<() => void> = [];
  const vaultOnCalls: string[] = [];
  const workspaceOnCalls: string[] = [];

  const app: FakeApp = {
    layoutReadyCallbacks,
    vaultOnCalls,
    workspaceOnCalls,
    fireLayoutReady: () => {
      layoutReadyCallbacks.forEach((cb) => cb());
    },
    vault: {
      on: (name: string, _cb: unknown) => {
        vaultOnCalls.push(name);
        return { eventName: name, kind: "vault" };
      },
      getConfig: (_k: string) => undefined,
    },
    workspace: {
      on: (name: string, _cb: unknown) => {
        workspaceOnCalls.push(name);
        return { eventName: name, kind: "workspace" };
      },
      onLayoutReady: (cb: () => void) => {
        layoutReadyCallbacks.push(cb);
      },
    },
  };
  return app;
}

async function loadPlugin(app: FakeApp): Promise<LocalImagesPlugin> {
  const plugin = new LocalImagesPlugin(app as any, {} as any);
  await plugin.onload();
  return plugin;
}

describe("plugin lifecycle", () => {
  let app: FakeApp;

  beforeEach(() => {
    app = makeFakeApp();
  });

  test("vault events are NOT registered before the workspace layout is ready", async () => {
    await loadPlugin(app);
    // Before layout-ready fires, no vault event handlers may exist —
    // otherwise Obsidian replays 'create' for every file in the vault
    // at startup (~42k events in a large vault).
    expect(app.vaultOnCalls).toEqual([]);
  });

  test("vault and workspace events are registered once layout is ready", async () => {
    await loadPlugin(app);
    app.fireLayoutReady();

    expect(app.vaultOnCalls).toContain("create");
    expect(app.vaultOnCalls).toContain("delete");
    expect(app.vaultOnCalls).toContain("rename");
    expect(app.vaultOnCalls).toContain("modify");
    expect(app.workspaceOnCalls).toContain("editor-paste");
  });

  test("every event handler is tracked via registerEvent for automatic cleanup", async () => {
    const plugin = await loadPlugin(app);
    app.fireLayoutReady();

    const totalEvents = app.vaultOnCalls.length + app.workspaceOnCalls.length;
    expect(totalEvents).toBeGreaterThan(0);
    // The stub Plugin base class records registerEvent() calls.
    expect((plugin as any).registeredEvents).toHaveLength(totalEvents);
  });
});
