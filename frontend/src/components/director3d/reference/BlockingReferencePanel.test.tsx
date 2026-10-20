import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { BlockingReferencePanel } from "./BlockingReferencePanel";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,blocking");
});

it("captures the current browser blocking view with shot package provenance", () => {
  const stage = document.createElement("div");
  stage.id = "director-viewport";
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  stage.appendChild(canvas);
  document.body.appendChild(stage);

  render(<BlockingReferencePanel />);
  fireEvent.click(screen.getByRole("button", { name: "导出当前占位图" }));

  expect(screen.getByRole("img", { name: /占位参考图/ })).toBeInTheDocument();
  expect(screen.getByText(/^fnv1a32:/)).toBeInTheDocument();
  expect(screen.getByText("浏览器占位参考 · 米制深度请使用“深度”工具提交。")).toBeInTheDocument();
});
