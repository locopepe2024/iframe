// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import DirectorInterpretationVisualEditor from "./DirectorInterpretationVisualEditor";

const profile = {
    setting: { locations: "Campus" },
    timeline: [{ phase: "University", events: "They meet", relationship_state: "Together", source: "Scene 1" }],
    relationships: [{ pair: "Shen Xia—Zhou Han", initial: "Close", change: "Long distance", final: "Separated", legacy_note: "keep me" }],
    key_events: [{ event: "Leaving", function: "Break in routine", weight: "turning point", source: "Scene 4" }],
    emotional_arc: "Longing",
    pacing: "Slow down at separation",
    visual_language: "Natural light",
    performance_direction: "Restrained",
    dialogue_direction: "Keep original dialogue",
    sound_direction: "Rain",
    continuity_constraints: ["Keep the ring on the left hand"],
    prohibitions: ["Do not invent a wedding"],
    unresolved_questions: ["Exact year"],
    future_field: { preserved: true },
};

function renderEditor(onChange = vi.fn()) {
    return {
        onChange,
        ...render(
            <NextIntlClientProvider locale="en" messages={messages}>
                <DirectorInterpretationVisualEditor profile={profile} onChange={onChange} />
            </NextIntlClientProvider>,
        ),
    };
}

it("edits timeline entries and reorders phases through accessible controls", () => {
    const onChange = vi.fn();
    renderEditor(onChange);

    fireEvent.change(screen.getByLabelText("Events"), { target: { value: "They meet and begin dating" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        timeline: [expect.objectContaining({ events: "They meet and begin dating" })],
    }));

    fireEvent.click(screen.getByRole("button", { name: "Add phase" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        timeline: [...profile.timeline, { phase: "", events: "", relationship_state: "", source: "" }],
    }));
});

it("renders a relationship map while keeping structured editing and unknown fields", () => {
    const onChange = vi.fn();
    renderEditor(onChange);

    expect(screen.getByRole("img", { name: /Relationship map with characters Shen Xia.*Zhou Han/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Change and turning points")).toHaveValue("Long distance");
    fireEvent.change(screen.getByLabelText("Ending state"), { target: { value: "They part ways" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        relationships: [expect.objectContaining({ final: "They part ways", legacy_note: "keep me" })],
        future_field: { preserved: true },
    }));
});
