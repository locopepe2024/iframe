import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PeopleAlbums from "./PeopleAlbums";
const api = vi.hoisted(() => ({ peopleAlbums: vi.fn(), personPhotos: vi.fn(), peopleCorrectionPreview: vi.fn() }));
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

it("selects exact faces, previews split and locks selection until cancel", async () => {
  const members = [{ task_id: "task", face_id: "first", box: [0,0,0.5,0.5] }, { task_id: "task", face_id: "second", box: [0.5,0,0.5,0.5] }];
  api.peopleAlbums.mockResolvedValue({ people: [{ person_id: "person", label: "家人", photo_count: 1 }], next_after_id: null });
  api.personPhotos.mockResolvedValue({ photos: [{ photo_id: "photo", boxes: members.map(m => m.box), members }], next_after_id: null });
  api.peopleCorrectionPreview.mockResolvedValue({ preview_token: "a".repeat(64), selection: { action: "split", person_id: "person" }, counts: { members: 1, photos: 1, preserve: 0 }, people: [], affected: [] });
  render(<PeopleAlbums />);
  fireEvent.click(screen.getByRole("button", { name: "查看已确认人物相册" }));
  fireEvent.click(await screen.findByRole("button", { name: "家人：1 张照片" }));
  fireEvent.click(await screen.findByRole("button", { name: "调整这个人物" }));
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "预览：拆成另一个人物" }));
  await screen.findByRole("region", { name: "人物调整确认" });
  expect(api.peopleCorrectionPreview).toHaveBeenCalledWith({ action: "split", person_id: "person", label: "", members: [{ task_id: "task", face_id: "first" }] });
  expect(screen.getAllByRole("checkbox")[0]).toBeDisabled();
  expect(screen.getByRole("button", { name: "查看已确认人物相册" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "返回，不调整" }));
  expect(screen.getAllByRole("checkbox")[0]).not.toBeDisabled();
});
