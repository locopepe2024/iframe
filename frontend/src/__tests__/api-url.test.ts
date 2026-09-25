import { describe, expect, it } from "vitest";

import { resolveBrowserApiUrl } from "@/lib/api";

describe("browser API URL resolution", () => {
  it("uses the same-origin proxy in browser development", () => {
    expect(resolveBrowserApiUrl(
      { protocol: "http:", hostname: "127.0.0.1", port: "3008" },
      "development",
      "17177",
    )).toBe("/api-proxy");
  });

  it("keeps Tauri pointed at the local backend", () => {
    expect(resolveBrowserApiUrl(
      { protocol: "tauri:", hostname: "localhost", port: "" },
      "development",
      "17177",
    )).toBe("http://127.0.0.1:17177");
  });

  it("uses the browser origin in production", () => {
    expect(resolveBrowserApiUrl(
      { protocol: "https:", hostname: "studio.example.test", port: "8443" },
      "production",
      "17177",
    )).toBe("https://studio.example.test:8443");
  });
});
