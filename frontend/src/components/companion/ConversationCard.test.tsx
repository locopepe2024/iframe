import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ConversationCard from "./ConversationCard";

it("renders media cards with explicit follow-up actions", () => {
  const onAction = vi.fn();
  render(<ConversationCard card={{ kind: "image", title: "女儿来看我", src: "/photo.webp", alt: "家庭照片" , action: "讲讲这张照片" }} onAction={onAction} />);
  expect(screen.getByRole("img", { name: "家庭照片" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "讲讲这张照片" }));
  expect(onAction).toHaveBeenCalledOnce();
});

it("keeps video as a playable card instead of auto-playing", () => {
  render(<ConversationCard card={{ kind: "video", title: "公园散步", src: "/walk.mp4", action: "说说这段视频" }} />);
  expect(screen.getByRole("button", { name: "说说这段视频" })).toBeInTheDocument();
  expect(document.querySelector("video")).not.toHaveAttribute("autoplay");
});
