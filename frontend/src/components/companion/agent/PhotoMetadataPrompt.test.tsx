import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import PhotoMetadataPrompt from "./PhotoMetadataPrompt";

const api = vi.hoisted(() => ({ description: vi.fn(), confirmDescription: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
beforeEach(() => {
  vi.resetAllMocks();
  api.description.mockResolvedValue(null);
  api.confirmDescription.mockImplementation((_id: string, body: { description: string }) => Promise.resolve({ revision: 1, description: body.description }));
});

it("offers classification after upload and saves only after explicit confirmation", async () => {
  render(<PhotoMetadataPrompt photoId="photo-1" />);
  fireEvent.click(screen.getByRole("button", { name: "现在整理" }));
  fireEvent.change(await screen.findByLabelText("照片备注"), { target: { value: "2026 年春天在公园拍的照片" } });
  fireEvent.click(screen.getByRole("button", { name: "核对备注" }));
  expect(api.confirmDescription).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "照片备注保存确认" })).toHaveTextContent("2026 年春天在公园拍的照片");
  fireEvent.click(screen.getByRole("button", { name: "确认保存备注" }));
  await screen.findByText("照片备注已保存，之后可以在相册里继续修改。");
  expect(api.confirmDescription).toHaveBeenCalledWith("photo-1", expect.objectContaining({ description: "2026 年春天在公园拍的照片", expected_revision: 0 }));
});

it("can defer photo classification without writing", async () => {
  render(<PhotoMetadataPrompt photoId="photo-1" />);
  fireEvent.click(screen.getByRole("button", { name: "以后再说" }));
  expect(await screen.findByText("好的，先不整理。照片已保存在相册里。")).toBeInTheDocument();
  expect(api.description).not.toHaveBeenCalled();
  expect(api.confirmDescription).not.toHaveBeenCalled();
});
