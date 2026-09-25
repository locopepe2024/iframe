// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { api } from "@/lib/api";
import { useProjectStore, type ScriptFactLedgerQueryResult } from "@/store/projectStore";
import { toast } from "@/store/toastStore";
import DirectorProfilePanel from "./DirectorProfilePanel";

const profile = {
    setting: { geography: "Chinese university and Beijing", era: "unknown" },
    timeline: [], relationships: [], key_events: [],
    emotional_arc: "Distance erodes intimacy", pacing: "restrained",
    visual_language: "Japanese live-action film language without relocation",
    performance_direction: "natural", dialogue_direction: "do not invent dialogue",
    sound_direction: "rain and phone silence", continuity_constraints: [],
    prohibitions: ["no invented Japanese cultural symbols"], unresolved_questions: ["exact era"],
    sample_plan: [],
};

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getDirectorProfileDraft").mockResolvedValue({
        project_id: "film", draft_revision: 0, source_revision: null, draft: null, updated_at: null,
    });
    vi.spyOn(api, "listDirectorProfileRevisions").mockResolvedValue([]);
    vi.spyOn(api, "listScriptFactLedgerRevisions").mockResolvedValue([]);
    vi.spyOn(api, "saveDirectorProfileDraft").mockImplementation(async (_projectId, sourceRevision, expectedDraftRevision, draft) => ({
        project_id: "film",
        draft_revision: expectedDraftRevision + 1,
        source_revision: sourceRevision,
        draft,
        updated_at: 10,
    }));
    useProjectStore.setState({
        currentProject: {
            id: "film", title: "Across the Shore", originalText: "script",
            characters: [], scenes: [], props: [], frames: [], status: "ready",
            createdAt: "", updatedAt: "",
        },
    });
});

it("keeps director analysis as a draft until explicit confirmation", async () => {
    vi.spyOn(api, "analyzeDirectorProfile").mockResolvedValue(profile);
    const apply = vi.spyOn(api, "applyDirectorProfile").mockResolvedValue({
        ...useProjectStore.getState().currentProject,
        art_direction: { selected_style_id: "director-profile", style_config: {}, custom_styles: [], ai_recommendations: [] },
    });
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorProfilePanel />
        </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate Director Interpretation" }));
    await waitFor(() => expect(
        (screen.getByLabelText("geography") as HTMLTextAreaElement).value,
    ).toContain("Chinese university and Beijing"));
    expect(apply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm direction" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("film", profile, undefined, 1));
    expect(api.saveDirectorProfileDraft).toHaveBeenCalledWith("film", 1, 0, profile);
});

it("loads the story map's pinned fact revision and displays exact source evidence for review", async () => {
    const analyzed = {
        ...profile,
        story_map: {
            schema_version: 1 as const,
            source_revision: 1,
            source_revision_id: "source-r1:test",
            fact_ledger_revision: 2,
            people: [],
            phases: [{
                phase_id: "phase-1", order: 0, label: "University", time_anchor: "", events: [{
                    event_id: "event-1", order: 0, title: "First", description: "They meet",
                    character_ids: [], dramatic_function: "", source_fact_ids: [], evidence_status: "interpretation" as const,
                }],
            }],
            relationship_arcs: [],
            story_threads: [],
        },
    };
    const result: ScriptFactLedgerQueryResult = {
        project_id: "film",
        ledger_revision: 2,
        source_revision: 1,
        source_revision_id: "source-r1:test",
        source_version: "test",
        offset_unit: "unicode_codepoint_half_open",
        facts: [{
            fact_id: "fact-meet", kind: "event", subject_ids: [], phase: null,
            source_revision: 1, source_revision_id: "source-r1:test", source_ranges: [{ start: 0, end: 25 }],
            value: { summary: "They meet in the library" }, evidence_status: "confirmed", conflict_group_id: null,
            evidence: [{ start: 0, end: 25, text: "They meet in the university library." }],
        }],
        offset: 0,
        total_facts: 1,
        truncated: false,
    };
    vi.spyOn(api, "analyzeDirectorProfile").mockResolvedValue(analyzed);
    vi.spyOn(api, "listScriptFactLedgerRevisions").mockResolvedValue([
        { revision: 2, source_revision: 1, source_revision_id: "source-r1:test", fact_count: 1, confirmed_at: 10 },
    ]);
    const getLedger = vi.spyOn(api, "getScriptFactLedger").mockResolvedValue(result);

    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorProfilePanel />
        </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate Director Interpretation" }));
    fireEvent.click(await screen.findByRole("button", { name: /First/ }));
    fireEvent.click(screen.getByText(/Script evidence/));

    await waitFor(() => expect(getLedger).toHaveBeenCalledWith("film", 1, 2, 0, 100));
    expect(await screen.findByText(/They meet in the university library/)).toBeInTheDocument();
});

it("saves an editable Director draft without making it active", async () => {
    vi.spyOn(api, "analyzeDirectorProfile").mockResolvedValue(profile);
    const apply = vi.spyOn(api, "applyDirectorProfile");
    const save = vi.spyOn(api, "saveDirectorProfileDraft");
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorProfilePanel />
        </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate Director Interpretation" }));
    await waitFor(() => expect(screen.getByLabelText("Format and genre")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Format and genre"), { target: { value: "Romantic drama" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);

    await waitFor(() => expect(save).toHaveBeenCalledWith(
        "film",
        1,
        0,
        expect.objectContaining({ setting: expect.objectContaining({ format_genre: "Romantic drama" }) }),
    ));
    expect(await screen.findByText("Saved draft v1")).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
});

it("restores a saved Director draft independently from the confirmed profile", async () => {
    vi.spyOn(api, "getDirectorProfileDraft").mockResolvedValue({
        project_id: "film",
        draft_revision: 3,
        source_revision: 1,
        draft: { ...profile, setting: { ...profile.setting, geography: "User-edited geography" } },
        updated_at: 10,
    });
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorProfilePanel />
        </NextIntlClientProvider>,
    );

    expect(await screen.findByText("Saved draft v3")).toBeInTheDocument();
    expect(screen.getByLabelText("geography")).toHaveValue("User-edited geography");
});

it("requires a fresh analysis after the source changes, then allows saving it against the new revision", async () => {
    useProjectStore.setState(state => ({
        currentProject: { ...state.currentProject!, source_revision: 2 },
    }));
    vi.spyOn(api, "getDirectorProfileDraft").mockResolvedValue({
        project_id: "film", draft_revision: 3, source_revision: 1, draft: profile, updated_at: 10,
    });
    vi.spyOn(api, "analyzeDirectorProfile").mockResolvedValue(profile);
    const save = vi.spyOn(api, "saveDirectorProfileDraft");
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorProfilePanel />
        </NextIntlClientProvider>,
    );

    expect(await screen.findByText(/script changed after this draft was saved/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Save draft" })[0]).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate Interpretation" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Director analysis complete"));

    expect(screen.queryByText(/script changed after this draft was saved/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Save draft" })[0]).toBeEnabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await waitFor(() => expect(save).toHaveBeenCalledWith(
        "film", 2, 3, profile,
    ));
});

it("surfaces the server detail when director revision fails", async () => {
    vi.spyOn(api, "analyzeDirectorProfile").mockResolvedValue(profile);
    vi.spyOn(api, "refineDirectorProfile").mockRejectedValue({
        response: { data: { detail: "Invalid director profile draft: setting must be an object" } },
    });
    const toastError = vi.spyOn(toast, "error");
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorProfilePanel />
        </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate Director Interpretation" }));
    await waitFor(() => expect(screen.getByLabelText("Locations")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(
        "Request a change, for example: keep the story in China; use Japanese style only as film language; emphasize the missed calls.",
    ), { target: { value: "Keep the story grounded" } });
    fireEvent.click(screen.getByRole("button", { name: "Revise" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
        "Invalid director profile draft: setting must be an object",
    ));
});

it("shows a visible status while director revision is running and after it completes", async () => {
    vi.spyOn(api, "analyzeDirectorProfile").mockResolvedValue(profile);
    let resolveRevision: (value: typeof profile) => void = () => undefined;
    vi.spyOn(api, "refineDirectorProfile").mockImplementation((_projectId, _draft, _instructions, onStatus) => {
        onStatus?.("processing");
        return new Promise<typeof profile>(resolve => {
            resolveRevision = resolve;
        });
    });
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorProfilePanel />
        </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate Director Interpretation" }));
    await waitFor(() => expect(screen.getByLabelText("Locations")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(
        "Request a change, for example: keep the story in China; use Japanese style only as film language; emphasize the missed calls.",
    ), { target: { value: "Condense this into a roughly one-minute sample" } });
    fireEvent.click(screen.getByRole("button", { name: "Revise" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
        "Updating the director profile from your revision request",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Processing");
    resolveRevision(profile);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(
        "Director revision complete",
    ));
});

it("sends only the current revision instruction after prior changes are merged", async () => {
    vi.spyOn(api, "analyzeDirectorProfile").mockResolvedValue(profile);
    const refine = vi.spyOn(api, "refineDirectorProfile").mockResolvedValue(profile);
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <DirectorProfilePanel />
        </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate Director Interpretation" }));
    await waitFor(() => expect(screen.getByLabelText("Locations")).toBeInTheDocument());
    const input = screen.getByPlaceholderText(
        "Request a change, for example: keep the story in China; use Japanese style only as film language; emphasize the missed calls.",
    );
    fireEvent.change(input, { target: { value: "Keep the story in China" } });
    fireEvent.click(screen.getByRole("button", { name: "Revise" }));
    await waitFor(() => expect(refine).toHaveBeenCalledWith(
        "film",
        profile,
        ["Keep the story in China"],
        expect.any(Function),
    ));

    fireEvent.change(input, { target: { value: "Condense to one minute" } });
    fireEvent.click(screen.getByRole("button", { name: "Revise" }));
    await waitFor(() => expect(refine).toHaveBeenLastCalledWith(
        "film",
        profile,
        ["Condense to one minute"],
        expect.any(Function),
    ));
});
