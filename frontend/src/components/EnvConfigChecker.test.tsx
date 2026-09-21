import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserConfig: vi.fn(),
  refreshUniArtModelCatalog: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: { getUserConfig: mocks.getUserConfig } }));
vi.mock("@/lib/modelCatalog", () => ({ refreshUniArtModelCatalog: mocks.refreshUniArtModelCatalog }));
vi.mock("@/components/project/EnvConfigDialog", () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div role="dialog">config</div> : null),
}));

import EnvConfigChecker, { isDirectorRoute } from "./EnvConfigChecker";

describe("EnvConfigChecker route boundaries", () => {
  beforeEach(() => {
    history.replaceState(null, "", "#/director");
    mocks.getUserConfig.mockReset();
    mocks.refreshUniArtModelCatalog.mockReset();
    mocks.refreshUniArtModelCatalog.mockResolvedValue(0);
  });

  afterEach(() => {
    history.replaceState(null, "", "#/");
  });

  it("recognizes the browser-only director route", () => {
    expect(isDirectorRoute("#/director")).toBe(true);
    expect(isDirectorRoute("#/recreation")).toBe(false);
  });

  it("does not query or block the director workbench", async () => {
    render(<EnvConfigChecker />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.getUserConfig).not.toHaveBeenCalled();
    expect(mocks.refreshUniArtModelCatalog).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the configuration gate for non-director routes", async () => {
    history.replaceState(null, "", "#/");
    mocks.getUserConfig.mockRejectedValueOnce(new Error("backend unavailable"));
    render(<EnvConfigChecker />);
    await waitFor(() => expect(mocks.getUserConfig).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("does not block when shared runtime credentials are available", async () => {
    history.replaceState(null, "", "#/recreation");
    mocks.getUserConfig.mockResolvedValueOnce({
      runtime_uniart_available: true,
      secrets_configured: {},
    });
    render(<EnvConfigChecker />);
    await waitFor(() => expect(mocks.getUserConfig).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks when runtime credentials are unavailable", async () => {
    history.replaceState(null, "", "#/recreation");
    mocks.getUserConfig.mockResolvedValueOnce({
      runtime_uniart_available: false,
      secrets_configured: {},
    });
    render(<EnvConfigChecker />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("closes an already-open gate when navigating to the director", async () => {
    history.replaceState(null, "", "#/");
    mocks.getUserConfig.mockResolvedValueOnce({ secrets_configured: {} });
    render(<EnvConfigChecker />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    history.replaceState(null, "", "#/director");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
