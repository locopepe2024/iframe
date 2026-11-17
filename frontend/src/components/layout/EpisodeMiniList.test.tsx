import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import EpisodeMiniList from "./EpisodeMiniList";

const { getProjectAuthoringContext } = vi.hoisted(() => ({ getProjectAuthoringContext: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/api", () => ({ api: { getProjectAuthoringContext } }));
vi.mock("@/lib/debugLog", () => ({ debugLog: { warn: vi.fn() } }));

beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/project/root-project";
    getProjectAuthoringContext.mockResolvedValue({
        available: true,
        root: { document_id: "outline", title: "总纲", project_id: "root-project", preview: "总纲预览" },
        episodes: [{ document_id: "episode", title: "第一集", project_id: "episode-project", episode_number: 1 }],
    });
});

it("switches episode projects with the active step as a query parameter", async () => {
    render(<EpisodeMiniList currentProjectId="root-project" activeStep="storyboard" />);

    fireEvent.click(await screen.findByTitle("第一集"));

    await waitFor(() => expect(window.location.hash).toBe("#/project/episode-project?step=storyboard"));
});
