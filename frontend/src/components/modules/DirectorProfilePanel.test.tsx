// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
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
    useProjectStore.setState({
        currentProject: {
            id: "film", title: "Across the Shore", originalText: "script",
            characters: [], scenes: [], props: [], frames: [], status: "ready",
            createdAt: "", updatedAt: "",
        },
    });
    vi.restoreAllMocks();
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

    fireEvent.click(screen.getByRole("button", { name: "Analyze script" }));
    await waitFor(() => expect(
        (screen.getByLabelText("Director profile draft") as HTMLTextAreaElement).value,
    ).toContain("Chinese university and Beijing"));
    expect(apply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm direction" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("film", profile));
});
