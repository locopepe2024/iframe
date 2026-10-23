import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationBoundary } from "./ApplicationBoundary";
const route = vi.hoisted(() => ({ pathname: "/companion" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/components/Providers", () => ({ Providers: ({ children }: { children: React.ReactNode }) => <div data-testid="providers">{children}</div> }));
vi.mock("@/components/EnvConfigChecker", () => ({ default: () => <div>config-check</div> }));
vi.mock("@/components/layout/TauriDragBar", () => ({ default: () => <div>desktop-drag</div> }));
describe("ApplicationBoundary", () => {
  it.each(["/companion", "/companion/", "/static/companion/", "/static/companion.html", "/companion/copilot-trial", "/companion/copilot-trial/", "/static/companion/copilot-trial.html", "/companion/agent", "/static/companion/agent.html", "/companion/photos", "/static/companion/photos.html"])("isolates %s from account/config initialization", pathname => {
    route.pathname = pathname; render(<ApplicationBoundary><p>demo</p></ApplicationBoundary>);
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.queryByTestId("providers")).not.toBeInTheDocument();
    expect(screen.queryByText("config-check")).not.toBeInTheDocument();
  });
  it.each(["/", "/companion/account", "/companion/copilot-trial/private", "/companion/copilot-trial-extra"])("preserves providers for %s", pathname => {
    route.pathname = pathname; render(<ApplicationBoundary><p>studio</p></ApplicationBoundary>);
    expect(screen.getByTestId("providers")).toBeInTheDocument();
    expect(screen.getByText("config-check")).toBeInTheDocument();
  });
});
