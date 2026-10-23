import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PhotoConversationCard from "./PhotoConversationCard";

vi.mock("./photos/PhotoImage", () => ({ default: ({ id }: { id: string }) => <img src={`/photo/${id}`} alt="照片缩略图" /> }));

it("shows a real photo reference with a clear route to tell its story", () => {
  const onOpen = vi.fn();
  render(<PhotoConversationCard photoId="photo-1" label="最近照片 1" onOpen={onOpen} />);
  expect(screen.getByRole("img", { name: "照片缩略图" })).toHaveAttribute("src", "/photo/photo-1");
  fireEvent.click(screen.getByRole("button", { name: "去相册讲讲这张照片" }));
  expect(onOpen).toHaveBeenCalledOnce();
});
