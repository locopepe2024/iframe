import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import DigitalCompanionPanel from "./DigitalCompanionPanel";

const mocks = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn(), interrupt: vi.fn() }));
vi.mock("./useRealtimeVoice", () => ({ useRealtimeVoice: () => ({ state: "idle", active: false, notice: "", lines: [], stop: mocks.stop, start: mocks.start, interrupt: mocks.interrupt }) }));

it("shows the configured companion identity and starts voice chat", () => {
  render(<DigitalCompanionPanel identity={{ name: "小安", avatar: "🌿", voice: "longanyang_v3.6" }} onClose={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "小安" })).toBeInTheDocument();
  expect(screen.getByText(/沉稳男声/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /开始说话/ }));
  expect(mocks.start).toHaveBeenCalledOnce();
});
