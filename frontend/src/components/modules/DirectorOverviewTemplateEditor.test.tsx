// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import DirectorOverviewTemplateEditor from "./DirectorOverviewTemplateEditor";

const save = vi.fn();
vi.mock("@/lib/api", () => ({ api: {
    saveDirectorOverviewTemplate: (...args: unknown[]) => save(...args),
    inheritDirectorOverviewTemplate: vi.fn(),
} }));

it("saves an enabled custom Director overview field without changing a profile", async () => {
    const onSaved = vi.fn();
    save.mockResolvedValue({ source: "project", template: { revision: 2, fields: [{ key: "jianghu_rules", label: "江湖秩序", purpose: "剧本中的江湖规则", enabled: true }] } });
    render(<DirectorOverviewTemplateEditor scope="projects" id="episode-1" state={{ source: "default", template: { revision: 1, fields: [{ key: "time_period", label: "故事时间", purpose: "原文时间", enabled: true }] } }} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText("字段标识 1"), { target: { value: "jianghu_rules" } });
    fireEvent.change(screen.getByLabelText("字段名称 1"), { target: { value: "江湖秩序" } });
    fireEvent.change(screen.getByLabelText("分析要求 1"), { target: { value: "剧本中的江湖规则" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("projects", "episode-1", {
        revision: 1,
        fields: [{ key: "jianghu_rules", label: "江湖秩序", purpose: "剧本中的江湖规则", enabled: true }],
    }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ source: "project" }));
});
