import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import AvatarWorkbench from "./AvatarWorkbench";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

it("starts the local adapter explicitly and preserves older identity revisions", async () => {
  render(<AvatarWorkbench />);

  expect(screen.queryByLabelText("Face structure")).not.toBeInTheDocument();
  expect(screen.getByText(/not connected/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Create test identity" }));
  fireEvent.change(screen.getByLabelText("Face structure"), { target: { value: "oval face" } });
  fireEvent.click(screen.getByRole("button", { name: "Save new revision" }));

  await waitFor(() => expect(screen.getByText("Current revision v2")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "v1" }));

  await waitFor(() => expect(screen.getByText(/Viewing revision v1/)).toBeInTheDocument());
  expect(screen.getByLabelText("Face structure")).toHaveValue("oval face");
});
