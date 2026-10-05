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

it("shows the Chinese animation catalog without hiding existing styles", async () => {
    vi.mocked(api.getStylePresets).mockResolvedValue({
        categories: [
            { id: "chinese_animation", name: "Chinese Animation", name_zh: "中式动画", sort_order: 5 },
            { id: "japanese_anime", name: "Japanese Anime", name_zh: "日式动漫", sort_order: 3 },
        ],
        presets: [
            { id: "chinese_expressive_wuxia_2d", category: "chinese_animation", name: "Expressive Ink Wuxia 2D", name_zh: "中式写意武侠 2D", positive_prompt: "ink contours", negative_prompt: "glossy CGI", thumbnail: null },
            { id: "modern_cel_anime", category: "japanese_anime", name: "Modern Cel Anime", name_zh: "现代赛璐璐动画", positive_prompt: "cel animation", negative_prompt: "photo", thumbnail: null },
        ],
    } as never);

    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <ArtDirection />
        </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Style selection" }));
    await waitFor(() => expect(screen.getByText("中式写意武侠 2D")).toBeVisible());
    expect(screen.getByText("现代赛璐璐动画")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "中式动画" }));
    expect(screen.getByText("中式写意武侠 2D")).toBeVisible();
    expect(screen.queryByText("现代赛璐璐动画")).not.toBeInTheDocument();
    expect(screen.getByText("预览图待制作")).toBeVisible();
});
