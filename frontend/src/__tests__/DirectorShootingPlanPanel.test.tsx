// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { api } from "@/lib/api";
import type {
    DirectorShootingPlan,
    DirectorShootingPlanState,
} from "@/lib/directorShootingPlan";
import { useProjectStore } from "@/store/projectStore";
import DirectorShootingPlanPanel from "../components/modules/DirectorShootingPlanPanel";

const plan: DirectorShootingPlan = {
    schema_version: 1,
    source_revision: 1,
    source_revision_id: "source-r1:script-hash",
    director_profile_revision: 2,
    director_profile_hash: "director-hash",
    effective_style_hash: "style-hash",
    generated_at: 10,
    unresolved_questions: [],
    scenes: [{
        scene_id: "scene-cinema",
        order: 0,
        scene_ref: "Scene 6 · Cinema · Day · Interior",
        heading: "Cinema entrance",
        location: "Cinema entrance",
        time_anchor: "Day",
        continues_previous_scene: false,
        continuity_in: "They approach from the street.",
        continuity_out: "They enter the lobby together.",
        duration_seconds: 4,
        environment_atmosphere: "People cross the bright lobby behind the couple.",
        unresolved_questions: [],
        source_chunk_refs: ["source:chars-0-80"],
        prop_ids: ["ticket"],
        beats: [{
            beat_id: "beat-entry",
            order: 0,
            title: "Walk in together",
            dramatic_purpose: "Establish their relaxed intimacy.",
            emotional_change: "They stay comfortable and close.",
            duration_seconds: 4,
            keep_with_next: false,
            source_chunk_refs: ["source:chars-0-80"],
            story_event_ids: ["event-cinema"],
            shots: [{
                shot_id: "shot-entry",
                order: 0,
                title: "Follow the couple",
                visual_intent: "Keep the cinema sign visible behind them.",
                director_effect: "Let the relaxed walk feel briefly fragile beneath the bright sign.",
                performance_action: "They exchange a relaxed glance and smile.",
                action_physics: "He holds her hand as they walk at the same pace.",
                shot_size: "Medium shot",
                camera_angle: "Eye level",
                composition: "The couple stays right of center with the entrance behind them.",
                camera_movement: "Slow forward tracking shot.",
                lighting: {
                    key_source: "Warm sign light from camera left.",
                    color_tone: "Warm faces against a cooler lobby.",
                    contrast: "Soft facial shadows with a brighter entrance.",
                    practical_sources: ["Cinema sign"],
                },
                duration_seconds: 4,
                dialogue: [],
                ambient_sound: "Lobby voices and soft footsteps.",
                character_ids: ["shen-xia-young"],
                prop_ids: ["ticket"],
            }],
        }],
    }],
};

const state = (draft: DirectorShootingPlan | null = null, draftRevision = 0, currentRevision = 0): DirectorShootingPlanState => ({
    project_id: "film",
    draft_revision: draftRevision,
    draft_updated_at: null,
    draft,
    current_revision: currentRevision,
    current: null,
    current_lineage: {
        source_revision: 1,
        source_revision_id: "source-r1:script-hash",
        director_profile_revision: 2,
        director_profile_hash: "director-hash",
        effective_style_hash: "style-hash",
    },
    readiness_error: null,
    draft_stale: false,
    current_stale: false,
    source_chunks: [{ source_ref: "source:chars-0-80", char_start: 0, char_end: 80 }],
});

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getDirectorShootingPlan").mockResolvedValue(state());
    vi.spyOn(api, "listDirectorShootingPlanRevisions").mockResolvedValue([]);
    useProjectStore.setState({
        currentProject: {
            id: "film", title: "Across the Shore", originalText: "script", source_revision: 1,
            characters: [{ id: "shen-xia-young", name: "Shen Xia", persona: "Shen Xia" }],
            scenes: [], props: [{ id: "ticket", name: "Ticket", description: "Cinema admission ticket" }], frames: [], status: "ready",
            createdAt: "", updatedAt: "",
        },
    });
});

it("shows a scene-beat-shot timeline and keeps generation separate from storyboard application", async () => {
    vi.spyOn(api, "generateDirectorShootingPlan").mockResolvedValue(plan);
    const save = vi.spyOn(api, "saveDirectorShootingPlanDraft").mockImplementation(async (_projectId, _sourceRevision, expectedRevision, draft) => ({
        project_id: "film",
        draft_revision: expectedRevision + 1,
        draft_updated_at: 20,
        draft,
    }));
    const confirmedState = state(plan, 1, 1);
    vi.spyOn(api, "getDirectorShootingPlan")
        .mockResolvedValueOnce(state())
        .mockResolvedValueOnce(confirmedState);
    const confirm = vi.spyOn(api, "confirmDirectorShootingPlan").mockResolvedValue({
        project_id: "film",
        current_revision: 1,
        current: {
            revision: 1,
            content_hash: "plan-hash",
            confirmed_at: 30,
            source_revision: 1,
            source_revision_id: "source-r1:script-hash",
            director_profile_revision: 2,
            director_profile_hash: "director-hash",
            effective_style_hash: "style-hash",
            scene_count: 1,
            beat_count: 1,
            shot_count: 1,
            duration_seconds: 4,
        },
        draft_revision: 1,
    });

    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorShootingPlanPanel />
        </NextIntlClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Generate plan draft" }));
    expect(await screen.findByText("1 shots", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Shot flow.*展开/i }));
    const shotNode = screen.getByRole("button", { name: /Open shot 1: Follow the couple/i });
    expect(shotNode).toBeInTheDocument();
    fireEvent.click(shotNode);
    expect(screen.getByText("Shot inspector")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editor view" }));
    fireEvent.click(screen.getByRole("button", { name: "Open scene" }));
    fireEvent.click(screen.getByRole("button", { name: "Open beat" }));
    expect(screen.getAllByText("4 sec")).toHaveLength(3);
    expect(screen.queryByRole("checkbox", { name: /Input chunk 1/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit source links (1 available)" }));
    expect(screen.getByRole("checkbox", { name: /Input chunk 1/ })).toBeChecked();
    const confirmButton = screen.getByRole("button", { name: "Confirm shooting plan" });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByText("Shot 1 · Follow the couple · Medium shot"));
    const performance = await screen.findByLabelText("Character performance (gaze, expression, posture, pace)");
    fireEvent.change(performance, { target: { value: "They trade a brief smile while keeping the same pace." } });
    const effect = screen.getAllByLabelText("Director effect (audience / editorial effect)").at(-1)!;
    fireEvent.change(effect, { target: { value: "Make the bright entrance feel emotionally unstable." } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(
        "film", 1, 0,
        expect.objectContaining({
            scenes: [expect.objectContaining({
                beats: [expect.objectContaining({
                    shots: [expect.objectContaining({
                        performance_action: "They trade a brief smile while keeping the same pace.",
                        director_effect: "Make the bright entrance feel emotionally unstable.",
                    })],
                })],
            })],
        }),
    ));
    expect(screen.getByRole("button", { name: "Confirm shooting plan" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm shooting plan" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(
        "film", 0, 1,
        expect.objectContaining({ scenes: expect.any(Array) }),
        "", "",
    ));
    expect(await screen.findByText(/Shooting plan v1 confirmed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create video task/ })).not.toBeInTheDocument();
});

it("distinguishes plan v2 from Director v2 and aligns the draft before confirmation", async () => {
    const oldPlan = { ...plan, director_profile_revision: 1, director_profile_hash: "old-director-hash" };
    vi.spyOn(api, "getDirectorShootingPlan").mockResolvedValue({
        ...state(oldPlan, 2, 2),
        draft_stale: true,
        current_stale: true,
        current: {
            revision: 2, content_hash: "old-plan-hash", confirmed_at: 20,
            source_revision: 1, source_revision_id: "source-r1:script-hash",
            director_profile_revision: 1, director_profile_hash: "old-director-hash",
            effective_style_hash: "style-hash", scene_count: 1, beat_count: 1,
            shot_count: 1, duration_seconds: 4,
        },
    });
    const save = vi.spyOn(api, "saveDirectorShootingPlanDraft").mockImplementation(async (_id, _source, expectedRevision, draft) => ({
        project_id: "film", draft_revision: expectedRevision + 1, draft_updated_at: 21, draft,
    }));
    const confirm = vi.spyOn(api, "confirmDirectorShootingPlan").mockResolvedValue({
        project_id: "film", current_revision: 3, current: {
            revision: 3, content_hash: "hash", confirmed_at: 30,
            source_revision: 1, source_revision_id: "source-r1:script-hash",
            director_profile_revision: 2, director_profile_hash: "director-hash",
            effective_style_hash: "style-hash", scene_count: 1, beat_count: 1,
            shot_count: 1, duration_seconds: 4,
        }, draft_revision: 3,
    });

    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorShootingPlanPanel />
        </NextIntlClientProvider>,
    );

    expect(await screen.findByText(/Shooting-plan draft r2 still uses older upstream inputs/i)).toBeInTheDocument();
    expect(screen.getByText("Director interpretation revision changed from 1 to 2.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit plan draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm shooting plan" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Link current Director interpretation and save draft" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(
        "film", 1, 2, expect.objectContaining({ director_profile_revision: 2, director_profile_hash: "director-hash" }),
    ));
    expect(await screen.findByText(/Confirmed shooting plan v2 still uses older upstream inputs/i)).toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: "Confirm shooting plan" });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(
        "film", 2, 3, expect.objectContaining({ director_profile_revision: 2 }), "", "",
    ));
});

it("does not stale a plan when only the visual style changes", async () => {
    vi.spyOn(api, "getDirectorShootingPlan").mockResolvedValue({
        ...state(plan, 1),
        current_lineage: {
            ...state(plan, 1).current_lineage,
            effective_style_hash: "new-style-hash",
        },
        draft_stale: false,
    });

    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorShootingPlanPanel />
        </NextIntlClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "Confirm shooting plan" })).toBeEnabled();
    expect(screen.queryByText(/visual style changed/i)).not.toBeInTheDocument();
});

it("does not relabel a draft from an older script source", async () => {
    vi.spyOn(api, "getDirectorShootingPlan").mockResolvedValue({
        ...state(plan, 2),
        current_lineage: {
            ...state(plan, 2).current_lineage,
            source_revision: 2,
            source_revision_id: "source-r2:new-script-hash",
        },
        draft_stale: true,
    });

    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorShootingPlanPanel />
        </NextIntlClientProvider>,
    );

    expect(await screen.findByText("Script revision changed from 1 to 2.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link current Director interpretation and save draft" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm shooting plan" })).toBeDisabled();
});

it("lets the user discard a generated but unsaved proposal", async () => {
    vi.spyOn(api, "generateDirectorShootingPlan").mockResolvedValue(plan);

    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorShootingPlanPanel />
        </NextIntlClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Generate plan draft" }));
    expect(await screen.findByText("1 shots", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard local changes" }));
    expect(await screen.findByText("No shooting-plan draft yet")).toBeInTheDocument();
});
