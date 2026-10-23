import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import FeatureCardNav from "./FeatureCardNav";

it("shows card navigation with one clear destination per card", () => {
  const onSelect = vi.fn();
  render(<FeatureCardNav onSelect={onSelect} />);
  expect(screen.getByRole("button", { name: /聊天/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /相册/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /回忆/ }));
  expect(onSelect).toHaveBeenCalledWith("diary");
});
