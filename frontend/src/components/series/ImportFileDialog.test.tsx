// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { api } from "@/lib/api";
import ImportFileDialog from "./ImportFileDialog";

it("allows clearing the episode count and submitting 60 without clamping while typing", async () => {
    const preview = vi.spyOn(api, "importFilePreview").mockResolvedValue({
        import_id: "preview",
        episodes: [],
    } as never);
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <ImportFileDialog isOpen onClose={() => undefined} />
        </NextIntlClientProvider>,
    );

    const count = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(count, { target: { value: "" } });
    expect(count.value).toBe("");
    fireEvent.change(count, { target: { value: "360" } });
    expect(count.value).toBe("360");
    expect(screen.getByRole("button", { name: "Parse and preview episodes" })).toBeDisabled();
    fireEvent.change(count, { target: { value: "60" } });
    expect(count.value).toBe("60");

    const file = new File(["第1集\n正文"], "story.txt", { type: "text/plain" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Parse and preview episodes" }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith(file, 60));
});
