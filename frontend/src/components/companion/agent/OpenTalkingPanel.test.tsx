import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import OpenTalkingPanel from "./OpenTalkingPanel";

it("renders the mobile voice panel and closes it", () => {
  const onClose = vi.fn();
  render(<OpenTalkingPanel onClose={onClose} />);
  expect(screen.getByTitle("OpenTalking 角色语音聊天")).toHaveAttribute("allow", "microphone; autoplay; camera");
  fireEvent.click(screen.getByRole("button", { name: "关闭语音聊天" }));
  expect(onClose).toHaveBeenCalledOnce();
});
