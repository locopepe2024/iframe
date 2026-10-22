import { useEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import PeopleCandidates from "./PeopleCandidates";
const api = vi.hoisted(() => ({ peopleGroups: vi.fn(), reviewPeopleGroup: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
vi.mock("./FacePhoto", () => ({ default: ({ onReady }: { onReady: (ready: boolean) => void }) => {
  useEffect(() => { onReady(true); }, []); return <span>人脸照片</span>;
} }));
const group = { group_id: "group", status: "pending", revision: 1, members: [
  { face_id: "one", photo_id: "photo", box: [0, 0, 0.5, 0.5] }, { face_id: "two", photo_id: "second", box: [0, 0, 0.5, 0.5] },
] };
beforeEach(() => {
  vi.resetAllMocks(); api.peopleGroups.mockResolvedValue({ ready: true, groups: [group] });
  api.reviewPeopleGroup.mockResolvedValue({ status: "confirmed", revision: 2, person_id: "person" });
});
it("choice and name preview do not save until final button; name may be empty", async () => {
  render(<PeopleCandidates taskId="task" version={1} />);
  fireEvent.click(await screen.findByRole("button", { name: "待核对人物组 1：2 张人脸" }));
  fireEvent.click(await screen.findByRole("button", { name: "是同一个人" }));
  expect(api.reviewPeopleGroup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "返回核对，不保存" }));
  expect(api.reviewPeopleGroup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "是同一个人" }));
  fireEvent.click(screen.getByRole("button", { name: "确认保存人物" }));
  await screen.findByText(/核对已保存/);
  expect(api.reviewPeopleGroup).toHaveBeenCalledWith("group", expect.objectContaining({ action: "confirm", label: "", expected_revision: 1, consent_version: 1 }));
});
it("lost confirmation response keeps operation ID on retry", async () => {
  api.reviewPeopleGroup.mockRejectedValueOnce(new Error("lost"));
  render(<PeopleCandidates taskId="task" version={1} />);
  fireEvent.click(await screen.findByRole("button", { name: "待核对人物组 1：2 张人脸" }));
  fireEvent.click(await screen.findByRole("button", { name: "是同一个人" }));
  fireEvent.change(screen.getByLabelText("怎么称呼？可以留空"), { target: { value: "家人" } });
  fireEvent.click(screen.getByRole("button", { name: "确认保存人物" }));
  await screen.findByText("lost");
  fireEvent.click(screen.getByRole("button", { name: "确认保存人物" }));
  await screen.findByText(/核对已保存/);
  expect(api.reviewPeopleGroup.mock.calls[0]).toEqual(api.reviewPeopleGroup.mock.calls[1]);
});
it("split and defer remain distinct from person confirmation", async () => {
  render(<PeopleCandidates taskId="task" version={1} />);
  fireEvent.click(await screen.findByRole("button", { name: "待核对人物组 1：2 张人脸" }));
  fireEvent.click(screen.getByRole("button", { name: "不是同一个人，分开核对" }));
  await screen.findByText(/核对已保存/);
  expect(api.reviewPeopleGroup).toHaveBeenCalledWith("group", expect.objectContaining({ action: "split" }));
  fireEvent.click(screen.getByRole("button", { name: "待核对人物组 1：2 张人脸" }));
  fireEvent.click(screen.getByRole("button", { name: "以后再说" }));
  await screen.findByText(/核对已保存/);
  expect(api.reviewPeopleGroup).toHaveBeenLastCalledWith("group", expect.objectContaining({ action: "defer" }));
});
