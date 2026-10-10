import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import AssetCoverBadges from "./AssetCoverBadges";

it("stacks the failure and shooting-plan badges in one cover status area", () => {
    render(<AssetCoverBadges planCount={3} failed error="Provider timeout" source="episode" />);
    const status = screen.getByLabelText("资产状态");
    expect(status).toHaveClass("flex-col");
    expect(status).toHaveTextContent("Generation failed");
    expect(status).toHaveTextContent("拍摄计划 · 3 条");
    expect(status).toHaveTextContent("本集资产");
    expect(screen.getByText("Generation failed")).toHaveAttribute("title", "Provider timeout");
});

it("shows series placement even without generation or plan status", () => {
    render(<AssetCoverBadges planCount={0} failed={false} source="series" />);
    expect(screen.getByLabelText("资产状态")).toHaveTextContent("系列共享");
});
