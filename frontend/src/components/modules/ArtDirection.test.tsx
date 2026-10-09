// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import ArtDirection from "./ArtDirection";

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getStylePresets").mockResolvedValue({ presets: [], categories: [] } as never);
    useProjectStore.setState({
        currentProject: {
            id: "film",
            title: "Across the Shore",
            originalText: "script",
            characters: [], scenes: [], props: [], frames: [],
            status: "ready", createdAt: "", updatedAt: "",
            art_direction: {
                selected_style_id: "style-1",
                style_config: { id: "style-1", name: "Natural", positive_prompt: "soft light", negative_prompt: "", is_custom: false },
                custom_styles: [], ai_recommendations: [],
                director_profile: {
                    revision: 2,
                    sample_plan: [{ range: "Scene 9", purpose: "Establish the pair contrast", focus: "Keep both couples in the shared library" }],
                },
            },
        } as never,
    });
});

it("provides keyboard-operable Director tabs and keeps sample notes in the reference section", () => {
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <ArtDirection />
        </NextIntlClientProvider>,
    );

    const tabs = screen.getByRole("tablist", { name: "Director workbench sections" });
    expect(screen.getByRole("tab", { name: /Story understanding/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: /Story understanding/ })).toBeVisible();

    fireEvent.keyDown(tabs, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Shooting plan" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Director shooting plan" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate plan draft" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create blank plan" })).toBeVisible();
    fireEvent.click(screen.getByText("Director sample-scene notes"));
    expect(screen.getByRole("heading", { name: "Scene 9" })).toBeVisible();
    expect(screen.getByText(/These notes are reference material/)).toBeVisible();

    fireEvent.keyDown(tabs, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Style selection" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Built-in Presets" })).toBeVisible();
});

it("shows Series Director context and keeps an inherited style unsaved", async () => {
    const style = { id: "series-style", name: "Series style", positive_prompt: "ink", negative_prompt: "", is_custom: false };
    vi.spyOn(api, "getSeries").mockResolvedValue({
        art_direction: { selected_style_id: style.id, style_config: style },
        director_profile_revisions: [{ revision: 4 }],
    } as never);
    const save = vi.spyOn(api, "saveArtDirection");
    const project = useProjectStore.getState().currentProject!;
    useProjectStore.setState({
        currentProject: {
            ...project,
            series_id: "series-1",
            art_direction: { ...project.art_direction!, selected_style_id: "director-profile", style_config: {} },
        } as never,
    });

    render(<NextIntlClientProvider locale="en" messages={messages}><ArtDirection /></NextIntlClientProvider>);

    expect(await screen.findByText(/confirmed Series Director understanding v4/)).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Style selection" }));
    expect(await screen.findByText(/Inherits series baseline/)).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: /Apply & Continue/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Apply & Continue/ }));
    expect(save).not.toHaveBeenCalled();
});
