// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import { AxiosError } from "axios";
import messages from "../../messages/en.json";
import { api } from "@/lib/api";
import type {
    DirectorShootingPlan,
    DirectorShootingPlanState,
} from "@/lib/directorShootingPlan";
import { useProjectStore } from "@/store/projectStore";
import type { DirectorProfile } from "@/store/projectStore";
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
    current_story_events: [{ id: "event-cinema", label: "University · Walk in together" }],
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

it("shows a readable AI plan and keeps generation separate from storyboard application", async () => {
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
    expect(await screen.findByText("Cinema entrance")).toBeInTheDocument();
    expect(screen.getByText("Emotional change: They stay comfortable and close.")).toBeInTheDocument();
    expect(screen.getByText("Keep the cinema sign visible behind them.")).toBeInTheDocument();
    expect(screen.getByText("Action: He holds her hand as they walk at the same pace.")).toBeInTheDocument();
    expect(screen.getByText(/Review scene continuity and shot intent; matching context is carried into storyboard and R2V prompts/)).toBeInTheDocument();
    expect(screen.getByText("Advanced scene continuity").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("button", { name: /Create blank plan/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Input chunk 1/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Scene assets and source links"));
    fireEvent.click(screen.getByRole("button", { name: "Edit source links (1 available)" }));
    expect(screen.getByRole("checkbox", { name: /Input chunk 1/ })).toBeChecked();
    const confirmButton = screen.getByRole("button", { name: "Confirm shooting plan" });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByText("Shot 1 · Follow the couple · Medium shot"));
    expect((await screen.findByText("Advanced shot constraints")).closest("details")).not.toHaveAttribute("open");
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

it("adopts an identical server draft after a stale revision save conflict", async () => {
    vi.spyOn(api, "getDirectorShootingPlan")
        .mockResolvedValueOnce(state(null, 1, 1))
        .mockResolvedValueOnce(state(plan, 2, 1));
    vi.spyOn(api, "generateDirectorShootingPlan").mockResolvedValue(plan);
    const save = vi.spyOn(api, "saveDirectorShootingPlanDraft").mockRejectedValue(
        new AxiosError("Conflict", "ERR_BAD_RESPONSE", undefined, undefined, { status: 409 } as never),
    );
    const confirm = vi.spyOn(api, "confirmDirectorShootingPlan").mockResolvedValue({
        project_id: "film", current_revision: 2, current: {} as never, draft_revision: 2,
    });

    render(<NextIntlClientProvider locale="en" messages={messages}><DirectorShootingPlanPanel /></NextIntlClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Generate plan draft" }));
    await screen.findByText("Cinema entrance");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("film", 1, 1, plan));
    expect(await screen.findByText(/Draft r2 is already saved on the server/)).toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: "Confirm shooting plan" });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    await waitFor(() => expect(confirm).toHaveBeenCalledWith("film", 1, 2, plan, "", ""));
});

it("creates paired continuity IDs without asking the user to type them", async () => {
    vi.spyOn(api, "getDirectorShootingPlan").mockResolvedValue(state(plan, 1, 0));
    const save = vi.spyOn(api, "saveDirectorShootingPlanDraft").mockImplementation(async (_id, _source, revision, draft) => ({
        project_id: "film", draft_revision: revision + 1, draft_updated_at: 20, draft,
    }));
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorShootingPlanPanel />
        </NextIntlClientProvider>,
    );

    expect(await screen.findByText("Cinema entrance")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Advanced scene continuity"));
    expect(screen.queryByLabelText("Physical place continuity ID")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create continuity group" }));
    fireEvent.change(screen.getAllByLabelText("Key source and direction")[0], { target: { value: "Window from west" } });
    fireEvent.change(screen.getAllByLabelText("Warm/cool tone")[0], { target: { value: "Warm" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const draft = save.mock.calls[0][3];
    expect(draft.scenes[0].place_continuity_id).toMatch(/^place-/);
    expect(draft.scenes[0].time_continuity_id).toMatch(/^time-/);
    expect(draft.lighting_baselines?.[0]).toEqual(expect.objectContaining({
        place_continuity_id: draft.scenes[0].place_continuity_id,
        time_continuity_id: draft.scenes[0].time_continuity_id,
        lighting: expect.objectContaining({ key_source: "Window from west", color_tone: "Warm" }),
    }));
});

it("requires a new plan from the current Director before confirmation", async () => {
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
    const generate = vi.spyOn(api, "generateDirectorShootingPlan").mockResolvedValue(plan);
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

    expect(await screen.findByText("No confirmed shooting plan matches Director v2.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm shooting plan" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Director v1/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate plan draft" }));
    await waitFor(() => expect(generate).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(
        "film", 1, 2, expect.objectContaining({ director_profile_revision: 2, director_profile_hash: "director-hash" }),
    ));
    expect(screen.queryByText(/Confirmed shooting plan v2 still uses older upstream inputs/i)).not.toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: "Confirm shooting plan" });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(
        "film", 2, 3, expect.objectContaining({ director_profile_revision: 2 }), "", "",
    ));
});

it("hides obsolete old-plan events from the current Director workspace", async () => {
    const oldPlan = {
        ...plan,
        director_profile_revision: 4,
        director_profile_hash: "old-director-hash",
        scenes: [{ ...plan.scenes[0], beats: [{ ...plan.scenes[0].beats[0], story_event_ids: ["evt_03"] }] }],
    };
    vi.spyOn(api, "getDirectorShootingPlan").mockResolvedValue({
        ...state(oldPlan, 5),
        current_lineage: { ...state().current_lineage, director_profile_revision: 5, director_profile_hash: "new-director-hash" },
        draft_stale: true,
    });
    vi.spyOn(api, "generateDirectorShootingPlan").mockResolvedValue({
        ...plan, director_profile_revision: 5, director_profile_hash: "new-director-hash",
    });

    render(<NextIntlClientProvider locale="en" messages={messages}><DirectorShootingPlanPanel /></NextIntlClientProvider>);

    expect(await screen.findByText("No confirmed shooting plan matches Director v5.")).toBeInTheDocument();
    expect(screen.queryByText(/evt_03/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate plan draft" }));
    expect(await screen.findByText(/Unsaved plan draft generated from confirmed Director v5/i)).toBeInTheDocument();
    expect(screen.queryByText(/Old plan events evt_03/)).not.toBeInTheDocument();
});

it("regenerates a new unsaved plan from the current confirmed Director and can restore the saved old draft", async () => {
    const oldPlan = { ...plan, director_profile_revision: 4, director_profile_hash: "old-director-hash" };
    const nextPlan = { ...plan, director_profile_revision: 6, director_profile_hash: "director-v6-hash" };
    vi.spyOn(api, "getDirectorShootingPlan").mockResolvedValue({
        ...state(oldPlan, 5),
        current_lineage: { ...state().current_lineage, director_profile_revision: 6, director_profile_hash: "director-v6-hash" },
        draft_stale: true,
    });
    const generate = vi.spyOn(api, "generateDirectorShootingPlan").mockResolvedValue(nextPlan);
    const save = vi.spyOn(api, "saveDirectorShootingPlanDraft");

    render(<NextIntlClientProvider locale="en" messages={messages}><DirectorShootingPlanPanel /></NextIntlClientProvider>);

    expect(await screen.findByText("No confirmed shooting plan matches Director v6.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate plan draft" }));
    await waitFor(() => expect(generate).toHaveBeenCalledWith("film", expect.any(Function), []));
    expect(await screen.findByText(/Unsaved plan draft generated from confirmed Director v6.*replace server draft r5/i)).toBeInTheDocument();
    expect(screen.queryByText(/Saved shooting-plan draft r5 is based on confirmed Director v4/i)).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard local changes" }));
    expect(await screen.findByText("No confirmed shooting plan matches Director v6.")).toBeInTheDocument();
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

    expect(await screen.findByText("No confirmed shooting plan matches Director v2.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm shooting plan" })).not.toBeInTheDocument();
});

it("lets the user discard a generated but unsaved proposal", async () => {
    vi.spyOn(api, "generateDirectorShootingPlan").mockResolvedValue(plan);

    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorShootingPlanPanel />
        </NextIntlClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Generate plan draft" }));
    expect(await screen.findByText("Shot 1 · Follow the couple · Medium shot")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard local changes" }));
    expect(await screen.findByText("No confirmed shooting plan matches Director v2.")).toBeInTheDocument();
});

it("reads only plans matching the selected historical Director content", async () => {
    const oldPlan = { ...plan, director_profile_revision: 4, director_profile_hash: "director-v4-hash" };
    const historicalDirector = { revision: 4, content_hash: "director-v4-hash" } as DirectorProfile;
    vi.spyOn(api, "getDirectorShootingPlan").mockResolvedValue(state(plan, 6, 6));
    vi.spyOn(api, "listDirectorShootingPlanRevisions").mockResolvedValue([
        {
            revision: 5, content_hash: "plan-v5", confirmed_at: 20,
            source_revision: 1, source_revision_id: plan.source_revision_id,
            director_profile_revision: 4, director_profile_hash: "director-v4-hash",
            effective_style_hash: "style-hash", scene_count: 1, beat_count: 1, shot_count: 1, duration_seconds: 4,
        },
        {
            revision: 6, content_hash: "plan-v6", confirmed_at: 30,
            source_revision: 1, source_revision_id: plan.source_revision_id,
            director_profile_revision: 6, director_profile_hash: "director-v6-hash",
            effective_style_hash: "style-hash", scene_count: 1, beat_count: 1, shot_count: 1, duration_seconds: 4,
        },
    ]);
    const read = vi.spyOn(api, "getDirectorShootingPlanRevision").mockResolvedValue({
        revision: 5, content_hash: "plan-v5", confirmed_at: 20,
        source_revision: 1, source_revision_id: plan.source_revision_id,
        director_profile_revision: 4, director_profile_hash: "director-v4-hash",
        effective_style_hash: "style-hash", scene_count: 1, beat_count: 1, shot_count: 1, duration_seconds: 4,
        plan: oldPlan,
    });

    render(<NextIntlClientProvider locale="en" messages={messages}>
        <DirectorShootingPlanPanel selectedDirector={historicalDirector} historical />
    </NextIntlClientProvider>);

    expect(await screen.findByText("Shooting plan v5 · from Director v4")).toBeInTheDocument();
    expect(screen.getByText(/Follow the couple · Medium shot/)).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith("film", 5);
    expect(screen.queryByRole("button", { name: "Generate plan draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm shooting plan" })).not.toBeInTheDocument();
});

it("treats generated lighting wording as inherited and asks once when an override is saved", async () => {
    const conflictingPlan: DirectorShootingPlan = {
        ...plan,
        lighting_baselines: [{
            place_continuity_id: "place-cinema", time_continuity_id: "time-day",
            story_time: "Day", daylight_phase: "day", weather: "clear", shadow_direction: "",
            lighting: { key_source: "Window from west", color_tone: "Warm", contrast: "Soft", practical_sources: [] },
        }],
        scenes: [{ ...plan.scenes[0], place_continuity_id: "place-cinema", time_continuity_id: "time-day" }],
    };
    vi.spyOn(api, "getDirectorShootingPlan").mockResolvedValue(state(conflictingPlan, 2));
    const save = vi.spyOn(api, "saveDirectorShootingPlanDraft").mockImplementation(async (_id, _source, revision, draft) => ({
        project_id: "film", draft_revision: revision + 1, draft_updated_at: 20, draft,
    }));
    const confirm = vi.spyOn(api, "confirmDirectorShootingPlan").mockResolvedValue({
        project_id: "film", current_revision: 1, current: null, draft_revision: 3,
    } as never);
    const confirmPrompt = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<NextIntlClientProvider locale="en" messages={messages}><DirectorShootingPlanPanel /></NextIntlClientProvider>);

    expect(await screen.findByRole("heading", { name: "Cinema entrance" })).toBeInTheDocument();
    expect(screen.queryByText(/shots differ from the place and time lighting baseline/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm shooting plan" })).toBeEnabled();
    fireEvent.click(screen.getByText("Shot 1 · Follow the couple · Medium shot"));
    expect(await screen.findByLabelText("Ambient sound")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason for independent lighting"), { target: { value: "The sign changes the light on their faces." } });
    fireEvent.change(screen.getAllByLabelText("Key source and direction").at(-1)!, { target: { value: "Cinema sign from camera left" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("film", 1, 2,
        expect.objectContaining({ scenes: [expect.objectContaining({ beats: [expect.objectContaining({ shots: [expect.objectContaining({
            lighting_override_reason: "The sign changes the light on their faces.",
            lighting_override_selected: true,
            lighting: expect.objectContaining({ key_source: "Cinema sign from camera left" }),
        })] })] })] })));
    expect(confirmPrompt).toHaveBeenCalledWith(expect.stringContaining("independent lighting"));
    expect(screen.getByRole("button", { name: "Confirm shooting plan" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm shooting plan" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirmPrompt).toHaveBeenCalledTimes(1);
});

vi.mock("@/lib/directorSkills", () => ({ useDirectorSkills: () => ({ catalog: [], selected: [], loading: false, saving: false, error: "", canRun: true, update: vi.fn(), retry: vi.fn() }) }));
