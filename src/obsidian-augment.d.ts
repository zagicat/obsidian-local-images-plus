// Type augmentations for APIs that exist at runtime but are missing from
// the pinned obsidian@0.16 typings / TS 4.2 DOM lib.

import "obsidian";

declare module "obsidian" {
  interface Vault {
    // Atomic read-modify-write. Available since Obsidian 1.1.
    process(file: TFile, fn: (data: string) => string): Promise<string>;
  }
}

declare global {
  interface OffscreenCanvas {
    convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob>;
  }
}
