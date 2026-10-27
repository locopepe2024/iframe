import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssemblyTracks } from "./AssemblyTracks";
import type { AssemblyEditPlan } from "@/lib/api";
import type { Project } from "@/store/projectStore";
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/lib/api", () => ({ api: { exportAssemblySubtitles: vi.fn() } }));
const plan: AssemblyEditPlan = { id: "p", scope: "project", revision: 1, target_duration_ms: 5000, provenance: {}, markers: [], lanes: [{ id: "sub", kind: "subtitle", allow_overlap: false, clips: [] }] };
const project = { id: "p", frames: [] } as unknown as Project;
describe("Assembly tracks", () => {
    it("creates a caption at the playhead without saving or rendering", () => {
        const onChange = vi.fn();
        render(<AssemblyTracks plan={plan} project={project} resourceId="p" saved={false} onChange={onChange} />);
        fireEvent.change(screen.getByRole("slider"), { target: { value: "1500" } });
        fireEvent.click(screen.getByRole("button", { name: "Add caption" }));
        expect(onChange.mock.calls[0][0].lanes[0].clips[0]).toMatchObject({ timeline_start_ms: 1500, timeline_end_ms: 3500, text: "New caption" });
        expect(screen.getByRole("button", { name: "Download SRT" })).toBeDisabled();
    });
    it("shows active captions and prevents adding overlapping cues", () => {
        const withCue = { ...plan, lanes: [{ ...plan.lanes[0], clips: [{ id: "c", timeline_start_ms: 0, timeline_end_ms: 2000, text: "Visible", source_refs: [], enabled: true }] }] };
        const onChange = vi.fn();
        render(<AssemblyTracks plan={withCue} project={project} resourceId="p" saved onChange={onChange} />);
        expect(screen.getAllByText("Visible").length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole("button", { name: "Add caption" }));
        expect(screen.getByRole("alert")).toHaveTextContent("overlaps");
        expect(onChange).not.toHaveBeenCalled();
    });
});
