// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import WhiteFaceModel from "./WhiteFaceModel";

const { uploadLibraryImage, createLibraryAsset } = vi.hoisted(() => ({
    uploadLibraryImage: vi.fn(), createLibraryAsset: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({ Canvas: () => <canvas /> }));
vi.mock("@/lib/api", () => ({ api: { uploadLibraryImage, createLibraryAsset } }));

beforeEach(() => {
    uploadLibraryImage.mockReset().mockResolvedValue({ image_url: "uploads/white-face.png" });
    createLibraryAsset.mockReset().mockResolvedValue({
        id: "face-prop", image_asset: { variants: [{ id: "face-v1" }] },
    });
    HTMLCanvasElement.prototype.toBlob = function (callback) {
        callback(new Blob(["white-face"], { type: "image/png" }));
    };
});

it("saves the edited geometry as a stable reference and matching prompt", async () => {
    const onSaved = vi.fn();
    render(<WhiteFaceModel characterName="探子首领" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    fireEvent.change(screen.getByLabelText(/脸部长度/), { target: { value: "112" } });
    fireEvent.change(screen.getByLabelText(/鼻尖突出度/), { target: { value: "118" } });
    fireEvent.change(screen.getByLabelText(/额头宽度/), { target: { value: "108" } });
    fireEvent.click(screen.getByText("嘴唇与下巴"));
    fireEvent.change(screen.getByLabelText(/嘴角倾斜/), { target: { value: "115" } });
    fireEvent.click(screen.getByRole("button", { name: "保存骨相参数" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(createLibraryAsset).toHaveBeenCalledWith("prop", expect.objectContaining({
        name: "探子首领 · 面部比例白模", image_url: "uploads/white-face.png",
        description: expect.stringContaining("脸长 112%"),
    }));
    expect(onSaved).toHaveBeenCalledWith(
        { asset_type: "prop", asset_id: "face-prop", variant_id: "face-v1", application_mode: "reference_only", applied_fields: ["face_geometry"] },
        expect.stringContaining("鼻尖突出度 118%"),
        expect.objectContaining({ faceLength: 112, foreheadWidth: 108, mouthCornerTilt: 115 }),
    );
    expect(createLibraryAsset.mock.calls[0][1].description).toContain("嘴角倾斜 115%");
});

it("restores saved proportions when the workbench reopens its design", () => {
    const { rerender } = render(<WhiteFaceModel characterName="探子首领" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    expect(screen.getByLabelText(/脸部长度/)).toHaveValue("100");

    rerender(<WhiteFaceModel characterName="探子首领" initialShape={{
        faceLength: 112, faceWidth: 90, cheekWidth: 105, jawWidth: 85,
        eyeSpacing: 96, noseProjection: 110,
    }} onSaved={vi.fn()} />);

    expect(screen.getByLabelText(/脸部长度/)).toHaveValue("112");
    expect(screen.getByLabelText(/下颌宽度/)).toHaveValue("85");
});
