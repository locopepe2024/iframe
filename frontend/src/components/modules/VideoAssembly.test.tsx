import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VideoAssembly from "./VideoAssembly";
import { buildDraftAssemblyPlan } from "./assemblyEditPlan";
import { useProjectStore, type Project } from "@/store/projectStore";
import { api } from "@/lib/api";

vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => (key: string) => key }));
vi.mock("@/lib/api", () => ({ API_URL: "http://localhost", api: { getProject: vi.fn(), saveAssemblyPlan: vi.fn(), renderAssemblyPlan: vi.fn() } }));

const source = (): Project => ({
    id: "project", title: "Example", originalText: "", characters: [], scenes: [], props: [],
    frames: [{ id: "frame", selected_video_id: "old", duration: 5 }],
    video_tasks: [{ id: "old", frame_id: "frame", status: "completed", video_url: "old.mp4", duration: 5 }],
    status: "draft", createdAt: "", updatedAt: "",
} as Project);

describe("Assembly variant refresh", () => {
    beforeEach(() => { vi.clearAllMocks(); });
    it("loads the pinned selection into the editable plan and saves it without resetting trims", async () => {
        const project = source();
        project.assembly_plan = buildDraftAssemblyPlan(project);
        project.assembly_plan.lanes[0].clips[0].source_start_ms = 1000;
        const fresh = structuredClone(project);
        (fresh.frames[0] as any).selected_video_id = "new";
        fresh.video_tasks!.push({ id: "new", frame_id: "frame", status: "completed", video_url: "new.mp4" } as any);
        vi.mocked(api.getProject).mockResolvedValue(fresh);
        vi.mocked(api.saveAssemblyPlan).mockImplementation(async (_scope, _id, plan) => ({ ...plan, revision: plan.revision + 1 }));
        useProjectStore.setState({ currentProject: project, projects: [project] });
        render(<VideoAssembly />);
        fireEvent.click(screen.getByRole("button", { name: "refreshTakes" }));
        await screen.findByText("refreshTakesDone");
        fireEvent.click(screen.getByRole("button", { name: "savePlan" }));
        await waitFor(() => expect(api.saveAssemblyPlan).toHaveBeenCalled());
        const saved = vi.mocked(api.saveAssemblyPlan).mock.calls[0][2];
        expect(saved.lanes[0].clips[0].source_task_id).toBe("new");
        expect(saved.lanes[0].clips[0].source_start_ms).toBe(1000);
    });
    it("refreshes stale saved references before rendering even without a manual refresh", async () => {
        const project = source();
        project.assembly_plan = buildDraftAssemblyPlan(project);
        const fresh = structuredClone(project);
        (fresh.frames[0] as any).selected_video_id = "new";
        fresh.video_tasks!.push({ id: "new", frame_id: "frame", status: "completed", video_url: "new.mp4" } as any);
        vi.mocked(api.getProject).mockResolvedValue(fresh);
        vi.mocked(api.saveAssemblyPlan).mockImplementation(async (_scope, _id, plan) => ({ ...plan, revision: plan.revision + 1 }));
        vi.mocked(api.renderAssemblyPlan).mockResolvedValue({ url: "result.mp4" });
        useProjectStore.setState({ currentProject: project, projects: [project] });
        render(<VideoAssembly />);
        fireEvent.click(screen.getByRole("button", { name: "phaseExport" }));
        fireEvent.click(screen.getByRole("button", { name: "renderAssembly" }));
        await waitFor(() => expect(api.renderAssemblyPlan).toHaveBeenCalledWith("project", "project"));
        expect(vi.mocked(api.saveAssemblyPlan).mock.calls[0][2].lanes[0].clips[0].source_task_id).toBe("new");
        expect(api.saveAssemblyPlan).toHaveResolved();
    });

});

it("undoes and redoes a draft edit, then clears history after save", async () => {
    const project = source(); project.assembly_plan = buildDraftAssemblyPlan(project);
    useProjectStore.setState({ currentProject: project, projects: [project] });
    vi.mocked(api.saveAssemblyPlan).mockImplementation(async (_scope, _id, plan) => ({ ...plan, revision: plan.revision + 1 }));
    render(<VideoAssembly />);
    const target = screen.getByRole("spinbutton", { name: "targetSeconds" });
    fireEvent.change(target, { target: { value: "10" } });
    expect(target).toHaveValue(10);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(target).toHaveValue(5);
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(target).toHaveValue(10);
    fireEvent.click(screen.getByRole("button", { name: "savePlan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
});
