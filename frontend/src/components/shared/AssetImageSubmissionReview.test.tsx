import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import AssetImageSubmissionReview from "./AssetImageSubmissionReview";

const preview = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: { previewAssetImageSubmission: preview } }));

const request = {
    asset_id: "street", asset_type: "scene" as const, generation_type: "all",
    prompt: "Blue street with pedestrians", negative_prompt: "red sunset",
    batch_size: 2, image_generation_mode: "reference" as const,
    references: [{ asset_type: "scene" as const, asset_id: "long-street", variant_id: "blue-1" }],
    apply_style: false as const, preserve_prompt: true as const,
};

it("shows the server-effective request and confirms its fingerprint", async () => {
    const projection = {
        positive_prompt: request.prompt, negative_prompt: request.negative_prompt,
        selected_model_id: "series-image-model", aspect_ratio: "16:9",
        generation_type: "all", image_generation_mode: "reference", batch_size: 2,
        reference_inputs: request.references, design_revision_at_submission: 4,
        fingerprint: "frozen-review",
    };
    preview.mockResolvedValueOnce(projection);
    const confirm = vi.fn();
    render(<AssetImageSubmissionReview projectId="project" request={request} onBack={vi.fn()} onConfirm={confirm} />);
    await waitFor(() => expect(screen.getByText("series-image-model")).toBeInTheDocument());
    expect(preview).toHaveBeenCalledWith("project", request);
    expect(screen.getByText("Blue street with pedestrians")).toBeInTheDocument();
    expect(screen.getByText("red sunset")).toBeInTheDocument();
    expect(screen.getByText("scene · long-street · blue-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    expect(confirm).toHaveBeenCalledWith(projection);
});

it("blocks confirmation when the preview text differs from the edited request", async () => {
    preview.mockResolvedValueOnce({
        positive_prompt: `${request.prompt}, hidden warm light`, negative_prompt: request.negative_prompt,
        selected_model_id: "model", aspect_ratio: "16:9", generation_type: "all",
        image_generation_mode: "reference", batch_size: 2,
        reference_inputs: request.references, design_revision_at_submission: null, fingerprint: "bad",
    });
    const confirm = vi.fn();
    render(<AssetImageSubmissionReview projectId="project" request={request} onBack={vi.fn()} onConfirm={confirm} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "确认并生成" })).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
});
