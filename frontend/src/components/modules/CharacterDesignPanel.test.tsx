import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CharacterDesignPanel from "./CharacterDesignPanel";
import { CharacterDictionaryHost } from "./CharacterPromptDictionary";

vi.mock("@/lib/api", () => ({ api: {
    getPlatformReferenceLibrary: vi.fn().mockResolvedValue({ resources: [] }),
} }));

it("opens, applies and reopens quick presets through the real prompt editor", async () => {
    const props: ComponentProps<typeof CharacterDesignPanel> = {
        description: "黑发少年", details: "原有角色设计", onDetailsChange: vi.fn(),
        result: null, onResultChange: vi.fn(), onDictionaryConfiguration: vi.fn(), configurations: [],
        supplemental: "", onSupplementalChange: vi.fn(), identityFields: {}, lookFields: {},
        metricBody: { heightM: "", bodyWidthM: "", reachM: "", armSpanM: "", legToTorsoRatio: "", shoulderToHeadWidthRatio: "", headToHeightRatio: "" },
        onMetricBodyChange: vi.fn(), onFieldsChange: vi.fn(), onDictionaryFields: vi.fn(),
        constraints: { must_keep: [], negative_prompt: [] }, onConstraintsChange: vi.fn(), reviewItems: [],
        models: [], model: "", onModelChange: vi.fn(), busy: false, saving: false,
        canSave: true, canReedit: false, error: "", status: "", tab: "design", onTabChange: vi.fn(),
        onSubmit: vi.fn(), onSave: vi.fn(), onReedit: vi.fn(),
    };
    const host = document.createElement("div");
    document.body.append(host);
    const view = render(<CharacterDictionaryHost.Provider value={host}>
        <CharacterDesignPanel {...props} />
    </CharacterDictionaryHost.Provider>);
    try {
        const editor = screen.getByRole("textbox", { name: "角色设计，/ 选择词典，[] 调整细节" });
        act(() => editor.focus());
        fireEvent.mouseDown(screen.getByRole("button", { name: "快捷面板" }));
        fireEvent.click(screen.getByRole("button", { name: "快捷面板" }));
        const panel = await screen.findByRole("dialog", { name: "基础面板、词典和 Prompt 模板" });
        expect(host).toContainElement(panel);
        expect(editor).toHaveTextContent("原有角色设计");
        expect(props.onDetailsChange).not.toHaveBeenCalled();
        fireEvent.click(within(panel).getByRole("option", { name: /^面容$/ }));
        fireEvent.change(within(panel).getByRole("combobox", { name: "脸型" }), { target: { value: "圆脸" } });
        fireEvent.click(within(panel).getByRole("button", { name: "应用配置" }));
        expect(props.onDictionaryFields).toHaveBeenCalledWith(expect.stringContaining("圆脸"),
            expect.objectContaining({ identity: expect.objectContaining({ face_shape: "圆脸" }) }), expect.any(String));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "快捷面板" }));
        await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
        view.unmount();
        host.remove();
    }
});
