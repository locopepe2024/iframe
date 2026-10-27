import { expect, it } from "vitest";
import { selectProjectSteps } from "./ProjectClient";

it("exposes Cast for an i2v episode in a series", () => {
    expect(selectProjectSteps("i2v_legacy", "series-1", "scripted").map(step => step.id))
        .toEqual(["script", "art_direction", "cast", "assets", "storyboard", "shot_design", "assembly"]);
});

it("keeps standalone i2v projects on their existing steps", () => {
    expect(selectProjectSteps("i2v_legacy", null, "scripted").map(step => step.id))
        .toEqual(["script", "art_direction", "assets", "storyboard", "shot_design", "assembly"]);
});
