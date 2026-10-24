// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import VideoPolishReview from "@/components/modules/storyboard-r2v/VideoPolishReview";

it("blocks an oversized MiniMax IR input and updates the count after editing", () => {
    const onChange = vi.fn();
    const onConfirm = vi.fn();
    const props = {
        media: [], formatNote: "IR input", isContextIr: true, isSubmitting: false,
        onChange, onCancel: vi.fn(), onConfirm,
    };
    const { rerender } = render(<VideoPolishReview {...props} messages={{ system: "", user: "x".repeat(7001) }} />);
    expect(screen.getByText(/7001\/7000 字符/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认输入并润色" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "送入 IR 的文字" }), { target: { value: "short input" } });
    expect(onChange).toHaveBeenCalledWith({ system: "", user: "short input" });
    rerender(<VideoPolishReview {...props} messages={{ system: "", user: "short input" }} />);
    expect(screen.getByText(/11\/7000 字符/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认输入并润色" }));
    expect(onConfirm).toHaveBeenCalledOnce();
});
