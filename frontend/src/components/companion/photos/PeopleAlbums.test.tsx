import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PeopleAlbums from "./PeopleAlbums";
const api = vi.hoisted(() => ({ peopleAlbums: vi.fn(), personPhotos: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
vi.mock("./FacePhoto", () => ({ default: () => <span>确认过的人脸照片</span> }));
it("browses only confirmed people and their photos without requiring a label", async () => {
  api.peopleAlbums.mockResolvedValue({ people: [{ person_id: "person", label: "", photo_count: 2 }], next_after_id: null });
  api.personPhotos.mockResolvedValue({ photos: [{ photo_id: "photo", boxes: [[0, 0, 0.5, 0.5]] }], next_after_id: null });
  render(<PeopleAlbums />);
  expect(api.peopleAlbums).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看已确认人物相册" }));
  fireEvent.click(await screen.findByRole("button", { name: "未填写称呼的人物 1：2 张照片" }));
  await screen.findByText("确认过的人脸照片");
  expect(api.personPhotos).toHaveBeenCalledWith("person", "");
});
