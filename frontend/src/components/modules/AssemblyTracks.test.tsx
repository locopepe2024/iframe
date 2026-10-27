import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssemblyTracks } from "./AssemblyTracks";
import type { AssemblyEditPlan } from "@/lib/api";
import type { Project } from "@/store/projectStore";
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/lib/api", () => ({ API_URL: "http://localhost:17177", api: { exportAssemblySubtitles: vi.fn() } }));
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

it("selects a burn-in lane and clears that selection when the lane is muted", () => {
    const captionPlan = { ...plan, lanes: [{ ...plan.lanes[0], clips: [{ id: "c", timeline_start_ms: 0, timeline_end_ms: 1000, text: "Hello", enabled: true, source_refs: [] }] }] };
    const onChange = vi.fn();
    const view = render(<AssemblyTracks plan={captionPlan} project={project} resourceId="p" saved onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Video captions" }), { target: { value: "sub" } });
    expect(onChange.mock.calls[0][0].burn_subtitle_lane_id).toBe("sub");
    view.rerender(<AssemblyTracks plan={{ ...captionPlan, burn_subtitle_lane_id: "sub" }} project={project} resourceId="p" saved onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mute / hide" }));
    expect(onChange.mock.calls[1][0].burn_subtitle_lane_id).toBeNull();
});

it("previews the exact timeline take and shows gain only after selection", () => {
    const videoProject = { id: "p", frames: [{ id: "f", image_url: "frame.jpg" }], video_tasks: [{ id: "take", status: "completed", video_url: "take.mp4" }] } as unknown as Project;
    const videoPlan = { ...plan, lanes: [{ id: "v", kind: "video" as const, allow_overlap: false, clips: [{ id: "shot", label: "Shot 1", source_project_id: "p", source_frame_id: "f", source_task_id: "take", timeline_start_ms: 0, timeline_end_ms: 5000, source_refs: [], enabled: true }] }] };
    render(<AssemblyTracks plan={videoPlan} project={videoProject} resourceId="p" saved onChange={vi.fn()} />);
    expect(screen.getByLabelText("Timeline video preview").getAttribute("src")).toContain("take.mp4");
    expect(screen.queryByRole("spinbutton")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Shot 1" }));
    expect(screen.getByRole("spinbutton", { name: "Shot 1 · Gain" })).toHaveValue(1);
});

it("maps seeking into a trimmed source and continues into the next shot", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const videoProject = { id: "p", frames: [], video_tasks: [{ id: "a", video_url: "a.mp4" }, { id: "b", video_url: "b.mp4" }] } as unknown as Project;
    const videoPlan: AssemblyEditPlan = { ...plan, target_duration_ms: 10000, lanes: [{ id: "v", kind: "video", allow_overlap: false, clips: [
        { id: "a", source_task_id: "a", timeline_start_ms: 0, timeline_end_ms: 5000, source_start_ms: 2000, source_end_ms: 12000, source_refs: [], enabled: true },
        { id: "b", source_task_id: "b", timeline_start_ms: 5000, timeline_end_ms: 10000, source_start_ms: 1000, source_end_ms: 6000, source_refs: [], enabled: true },
    ] }] };
    render(<AssemblyTracks plan={videoPlan} project={videoProject} resourceId="p" saved onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1500" } });
    const video = screen.getByLabelText("Timeline video preview") as HTMLVideoElement;
    expect(video.currentTime).toBe(5);
    expect(video.playbackRate).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    video.currentTime = 12;
    fireEvent.timeUpdate(video);
    const next = screen.getByLabelText("Timeline video preview") as HTMLVideoElement;
    expect(next.getAttribute("src")).toContain("b.mp4");
    expect(next.currentTime).toBe(1);
    expect(screen.getByRole("slider")).toHaveValue("5000");
    expect(play).toHaveBeenCalled();
    play.mockRestore();
});

it("does not replace an unavailable saved take with the frame's newer video", () => {
    const unavailable: AssemblyEditPlan = { ...plan, lanes: [{ id: "v", kind: "video", allow_overlap: false, clips: [{ id: "missing", source_frame_id: "f", source_task_id: "deleted", timeline_start_ms: 0, timeline_end_ms: 5000, enabled: true, source_refs: [] }] }] };
    render(<AssemblyTracks plan={unavailable} project={{ ...project, frames: [{ id: "f", video_url: "newer.mp4" }] } as Project} resourceId="p" saved onChange={vi.fn()} />);
    expect(screen.queryByLabelText("Timeline video preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
});

it("previews the selected dialogue source without changing its timeline bounds", () => {
    const audioProject = { id: "p", frames: [{ id: "f", audio_url: "dialogue.wav" }], video_tasks: [] } as unknown as Project;
    const audioPlan: AssemblyEditPlan = { ...plan, lanes: [{ id: "d", kind: "dialogue", allow_overlap: true, clips: [{ id: "cue", source_frame_id: "f", timeline_start_ms: 1200, timeline_end_ms: 3400, source_refs: [], enabled: true }] }] };
    const onChange = vi.fn();
    render(<AssemblyTracks plan={audioPlan} project={audioProject} resourceId="p" saved onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "cue" }));
    expect(screen.getByLabelText("Selected audio preview").getAttribute("src")).toContain("dialogue.wav");
    expect(screen.getAllByRole("spinbutton").at(-1)).toHaveValue(1);
    expect(onChange).not.toHaveBeenCalled();
});
