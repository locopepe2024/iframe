import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MotionJointReviewEditor } from "./MotionJointReviewEditor";
afterEach(cleanup);
it("preserves estimated depth when applying a 2D correction", () => {
  const apply = vi.fn();
  render(<MotionJointReviewEditor joints={{ left_shoulder: [0.4, 0.3, -0.12] }} onApply={apply} />);
  fireEvent.change(screen.getByLabelText("图像 X"), { target: { value: "0.45" } });
  fireEvent.click(screen.getByRole("button", { name: "应用关节修正" }));
  expect(apply).toHaveBeenCalledWith("left_shoulder", [0.45, 0.3, -0.12]);
});
it("rejects empty coordinates and missing depth instead of fabricating joints", () => {
  const apply = vi.fn();
  const view = render(<MotionJointReviewEditor joints={{ left_shoulder: [0.4, 0.3, -0.12] }} onApply={apply} />);
  fireEvent.change(screen.getByLabelText("图像 X"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "应用关节修正" }));
  expect(screen.getByRole("alert")).toHaveTextContent("0–1");
  expect(apply).not.toHaveBeenCalled();
  view.unmount();
  render(<MotionJointReviewEditor joints={{}} onApply={apply} />);
  fireEvent.click(screen.getByRole("button", { name: "应用关节修正" }));
  expect(screen.getByRole("alert")).toHaveTextContent("没有深度证据");
  expect(apply).not.toHaveBeenCalled();
});
