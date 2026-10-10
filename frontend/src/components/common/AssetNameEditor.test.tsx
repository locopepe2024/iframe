import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import AssetNameEditor from "./AssetNameEditor";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

it("renames an asset and leaves its identity to the caller", async () => {
  const onRename = vi.fn().mockResolvedValue(undefined);
  render(<AssetNameEditor name="苏砚" onRename={onRename} />);
  fireEvent.click(screen.getByRole("button", { name: "renameAsset" }));
  fireEvent.change(screen.getByRole("textbox", { name: "assetName" }), { target: { value: "  雪痕客  " } });
  fireEvent.click(screen.getByRole("button", { name: "saveName" }));
  await waitFor(() => expect(onRename).toHaveBeenCalledWith("雪痕客"));
});

it("keeps the editor open when saving fails", async () => {
  const onRename = vi.fn().mockRejectedValue(new Error("network"));
  render(<AssetNameEditor name="苏砚" onRename={onRename} />);
  fireEvent.click(screen.getByRole("button", { name: "renameAsset" }));
  fireEvent.change(screen.getByRole("textbox", { name: "assetName" }), { target: { value: "新名称" } });
  fireEvent.click(screen.getByRole("button", { name: "saveName" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("renameFailed");
  expect(screen.getByRole("textbox", { name: "assetName" })).toHaveValue("新名称");
});

it("cancels an edit with Escape without renaming", () => {
  const onRename = vi.fn();
  render(<AssetNameEditor name="苏砚" onRename={onRename} />);
  fireEvent.click(screen.getByRole("button", { name: "renameAsset" }));
  fireEvent.change(screen.getByRole("textbox", { name: "assetName" }), { target: { value: "新名称" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "assetName" }), { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "assetName" })).not.toBeInTheDocument();
  expect(screen.getByText("苏砚")).toBeInTheDocument();
  expect(onRename).not.toHaveBeenCalled();
});
