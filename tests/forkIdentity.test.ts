import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { APP_TITLE } from "../src/config";

// Obsidian's community updater matches installed plugins by manifest id.
// Keeping the upstream id lets an upstream release overwrite this fork,
// so the fork must carry its own id.
const manifest = JSON.parse(
  readFileSync(join(__dirname, "..", "manifest.json"), "utf8")
);

describe("fork identity", () => {
  it("uses a fork-specific plugin id", () => {
    expect(manifest.id).toBe("obsidian-local-images-plus-zc");
  });

  it("shows the fork in its display name", () => {
    expect(manifest.name).toBe("Local Images Plus zc");
  });

  it("shows the fork in the in-app title", () => {
    expect(APP_TITLE).toContain("Local Images Plus zc");
    expect(APP_TITLE).toContain(manifest.version);
  });
});
