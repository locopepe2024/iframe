// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
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

    fireEvent.click(screen.getByRole("button", { name: "Generate Director Interpretation" }));
    await waitFor(() => expect(
        (screen.getByLabelText("Director profile draft") as HTMLTextAreaElement).value,
    ).toContain("Chinese university and Beijing"));
    expect(apply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm direction" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("film", profile));
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
    await waitFor(() => expect(screen.getByLabelText("Director profile draft")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(
        "Request a change, for example: keep the story in China; use Japanese style only as film language; emphasize the missed calls.",
    ), { target: { value: "Keep the story grounded" } });
    fireEvent.click(screen.getByRole("button", { name: "Revise" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
        "Invalid director profile draft: setting must be an object",
    ));
});
