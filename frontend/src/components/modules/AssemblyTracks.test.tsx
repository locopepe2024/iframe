import { useState } from "react";
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
        fireEvent.change(screen.getByRole("slider", { name: "Timeline playhead" }), { target: { value: "1500" } });
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
    expect(screen.queryByRole("spinbutton", { name: "Shot 1 · Gain" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit clip 1: Shot 1" }));
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
    fireEvent.change(screen.getByRole("slider", { name: "Timeline playhead" }), { target: { value: "1500" } });
    const video = screen.getByLabelText("Timeline video preview") as HTMLVideoElement;
    expect(video.currentTime).toBe(5);
    expect(video.playbackRate).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    video.currentTime = 12;
    fireEvent.timeUpdate(video);
    const next = screen.getByLabelText("Timeline video preview") as HTMLVideoElement;
    expect(next.getAttribute("src")).toContain("b.mp4");
    expect(next.currentTime).toBe(1);
    expect(screen.getByRole("slider", { name: "Timeline playhead" })).toHaveValue("5000");
    expect(play).toHaveBeenCalled();
    play.mockRestore();
});

it("does not replace an unavailable saved take with the frame's newer video", () => {
    const unavailable: AssemblyEditPlan = { ...plan, lanes: [{ id: "v", kind: "video", allow_overlap: false, clips: [{ id: "missing", source_frame_id: "f", source_task_id: "deleted", timeline_start_ms: 0, timeline_end_ms: 5000, enabled: true, source_refs: [] }] }] };
    render(<AssemblyTracks plan={unavailable} project={{ ...project, frames: [{ id: "f", video_url: "newer.mp4" }] } as Project} resourceId="p" saved onChange={vi.fn()} />);
    expect(screen.queryByLabelText("Timeline video preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
});

it("offers visible sequence controls and recombines trimmed and split sources", () => {
    const initial: AssemblyEditPlan = { ...plan, target_duration_ms: 9000, lanes: [{ id: "v", kind: "video", allow_overlap: false, clips: [1, 2, 3].map((n, i) => ({ id: `c${n}`, label: `${n}.mp4`, source_media_id: `m${n}`, source_start_ms: 0, source_end_ms: 3000, timeline_start_ms: i * 3000, timeline_end_ms: (i + 1) * 3000, enabled: true, source_refs: [] })) }] };
    let latest = initial;
    function Editor() {
        const [value, setValue] = useState(initial);
        return <AssemblyTracks plan={value} project={project} resourceId="p" saved={false} onChange={next => { latest = next; setValue(next); }} />;
    }
    render(<Editor />);
    expect(screen.queryByRole("region", { name: "Video sequence" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit clip 2: 2.mp4" }));
    fireEvent.click(screen.getByRole("button", { name: "Move earlier" }));
    const ordered = () => latest.lanes[0].clips.slice().sort((a,b) => a.timeline_start_ms - b.timeline_start_ms);
    expect(ordered().map(c => c.label)).toEqual(["2.mp4", "1.mp4", "3.mp4"]);
    fireEvent.click(screen.getByRole("button", { name: "Edit clip 2: 1.mp4" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Source in (ms)" }), { target: { value: "500" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Source out (ms)" }), { target: { value: "2500" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply trim at original speed" }));
    expect(ordered()[1]).toMatchObject({ source_start_ms: 500, source_end_ms: 2500, timeline_start_ms: 3000, timeline_end_ms: 5000 });
    fireEvent.change(screen.getByRole("slider", { name: "Timeline playhead" }), { target: { value: "4000" } });
    fireEvent.click(screen.getByRole("button", { name: "Split at playhead" }));
    expect(ordered().map(c => c.source_media_id)).toEqual(["m2", "m1", "m1", "m3"]);
    const secondHalf = ordered()[2];
    expect(secondHalf).toMatchObject({ source_start_ms: 1500, source_end_ms: 2500 });
    fireEvent.click(screen.getByRole("button", { name: "Edit clip 3: 1.mp4" }));
    fireEvent.click(screen.getByRole("button", { name: "Move later" }));
    expect(ordered().map(c => c.source_media_id)).toEqual(["m2", "m1", "m3", "m1"]);
    expect(latest.target_duration_ms).toBe(8000);
});


it("zooms the shared ruler, seeks precisely, and fits without changing clip ranges", () => {
    const onChange = vi.fn();
    const view = render(<AssemblyTracks plan={plan} project={project} resourceId="p" saved onChange={onChange} />);
    const canvas = () => view.container.querySelector('[data-timeline-canvas]') as HTMLElement;
    const initial = canvas().style.width;
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(canvas().style.width).not.toBe(initial);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Playhead (seconds)" }), { target: { value: "1.234" } });
    expect(screen.getByRole("slider", { name: "Timeline playhead" })).toHaveValue("1234");
    fireEvent.click(screen.getByRole("button", { name: "Fit timeline" }));
    expect(canvas().style.width).toBe(initial);
    expect(screen.getByRole("spinbutton", { name: "Playhead (seconds)" })).toHaveValue(1.234);
    expect(onChange).not.toHaveBeenCalled();
});

it("splits the video under the precise playhead without hidden clip selection", () => {
    const initial: AssemblyEditPlan = { ...plan, target_duration_ms: 30000, lanes: [{ id: "v", kind: "video", allow_overlap: false, clips: [{ id: "one", label: "1.mp4", source_media_id: "m1", timeline_start_ms: 0, timeline_end_ms: 30000, source_start_ms: 0, source_end_ms: 30000, enabled: true, source_refs: [] }] }] };
    const onChange = vi.fn();
    render(<AssemblyTracks plan={initial} project={project} resourceId="p" saved onChange={onChange} />);
    const split = screen.getByRole("button", { name: "Split at playhead" });
    expect(split).toBeDisabled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Playhead (seconds)" }), { target: { value: "16.484" } });
    expect(split).toBeEnabled();
    expect(screen.getByText(/Split target: 1.mp4/)).toBeVisible();
    fireEvent.click(split);
    const clips = onChange.mock.calls[0][0].lanes[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ source_start_ms: 0, source_end_ms: 16484, timeline_start_ms: 0, timeline_end_ms: 16484 });
    expect(clips[1]).toMatchObject({ source_start_ms: 16484, source_end_ms: 30000, timeline_start_ms: 16484, timeline_end_ms: 30000 });
});
