// Minimal stub of the "obsidian" module for unit tests.
// Only the surface actually imported by src/ is stubbed.

export class Notice {
  message: string;
  constructor(message: string, _timeout?: number) {
    this.message = message;
  }
  setMessage(_msg: string) {}
  hide() {}
}

export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "";
  stat = { ctime: 0, mtime: 0, size: 0 };
  parent: TFolder | null = null;
}

export class TFolder {
  path = "";
  name = "";
  children: unknown[] = [];
}

export class Plugin {
  app: unknown;
  registeredEvents: unknown[] = [];
  registeredIntervals: number[] = [];

  constructor(app?: unknown, _manifest?: unknown) {
    this.app = app;
  }
  addCommand(_cmd: unknown) {}
  addRibbonIcon(_icon: string, _title: string, _cb: () => void) {}
  addSettingTab(_tab: unknown) {}
  registerEvent(evtRef: unknown) {
    this.registeredEvents.push(evtRef);
  }
  registerInterval(id: number) {
    this.registeredIntervals.push(id);
    return id;
  }
  async loadData(): Promise<unknown> {
    return {};
  }
  async saveData(_data: unknown): Promise<void> {}
}

export class Editor {}
export class MarkdownView {}
export class PluginSettingTab {
  app: unknown;
  constructor(app: unknown, _plugin: unknown) {
    this.app = app;
  }
}
export class Setting {
  constructor(_el: unknown) {}
  setName() { return this; }
  setDesc() { return this; }
  addToggle() { return this; }
  addText() { return this; }
  addDropdown() { return this; }
  addSlider() { return this; }
}
export class Modal {
  app: unknown;
  contentEl = { createEl: () => ({}), empty: () => {} };
  constructor(app: unknown) {
    this.app = app;
  }
  open() {}
  close() {}
}

export function htmlToMarkdown(html: string): string {
  return html;
}

// requestUrl is replaced per-test via vi.mock / setRequestUrlImpl.
export type RequestUrlResponse = { arrayBuffer: ArrayBuffer };
let requestUrlImpl: (opts: { url: string; headers?: unknown }) => Promise<RequestUrlResponse> =
  async () => {
    throw new Error("requestUrl stub not configured");
  };

export function setRequestUrlImpl(
  impl: (opts: { url: string; headers?: unknown }) => Promise<RequestUrlResponse>
) {
  requestUrlImpl = impl;
}

export async function requestUrl(opts: { url: string; headers?: unknown }) {
  return requestUrlImpl(opts);
}
