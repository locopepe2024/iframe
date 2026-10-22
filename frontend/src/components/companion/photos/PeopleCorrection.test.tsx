import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import PeopleCorrection from "./PeopleCorrection";
const api = vi.hoisted(() => ({ peopleCorrectionPreview: vi.fn(), correctPeople: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
vi.mock("./FacePhoto", () => ({ default: ({ onReady }: { onReady: (value: boolean) => void }) => <button onClick={() => onReady(true)}>模拟照片加载成功</button> }));
const selection = { action: "remove" as const, person_id: "person", members: [{ task_id: "task", face_id: "face" }] };
const face = { task_id: "task", face_id: "face", photo_id: "photo", box: "[0,0,0.5,0.5]" };
const plan = { preview_token: "a".repeat(64), selection, counts: { members: 1, photos: 1, preserve: 0 }, people: [{ person_id: "person", label: "", members: [face] }], affected: [{ ...face, person_id: "person" }] };
beforeEach(() => { vi.resetAllMocks(); api.peopleCorrectionPreview.mockResolvedValue(plan); api.correctPeople.mockResolvedValue({ counts: plan.counts }); });
it("previews without writing, blocks unloaded photos and cancels without changes", async () => {
  const active = vi.fn(); render(<PeopleCorrection selection={selection} onActiveChange={active} />);
  fireEvent.click(screen.getByRole("button", { name: "预览：移出所选人脸" }));
  const confirm = await screen.findByRole("button", { name: "确认移出所选人脸" });
  expect(confirm).toBeDisabled(); expect(api.correctPeople).not.toHaveBeenCalled(); expect(active).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "返回，不调整" }));
  expect(api.correctPeople).not.toHaveBeenCalled(); expect(active).toHaveBeenLastCalledWith(false);
});
it("retains identical operation on uncertain response and requires final button", async () => {
  const saved = vi.fn().mockResolvedValue(undefined); api.correctPeople.mockRejectedValueOnce(new Error("回执未收到"));
  render(<PeopleCorrection selection={selection} onSaved={saved} />);
  fireEvent.click(screen.getByRole("button", { name: "预览：移出所选人脸" }));
  await screen.findByRole("button", { name: "确认移出所选人脸" });
  fireEvent.click(screen.getByRole("button", { name: "模拟照片加载成功" }));
  fireEvent.click(screen.getByRole("button", { name: "确认移出所选人脸" })); await screen.findByRole("alert");
  const first = api.correctPeople.mock.calls[0][0];
  fireEvent.click(screen.getByRole("button", { name: "确认移出所选人脸" })); await screen.findByText("已保存，调整了 1 个人脸关系。");
  expect(api.correctPeople.mock.calls[1][0]).toEqual(first); expect(first.method).toBe("button"); expect(saved).toHaveBeenCalledOnce();
});
it("shows protected count for batch undo and disables empty undo", async () => {
  api.peopleCorrectionPreview.mockResolvedValue({ ...plan, selection: { action: "undo_batch", batch_id: "batch" }, people: [], affected: [], counts: { members: 0, photos: 0, preserve: 2 } });
  render(<PeopleCorrection selection={{ action: "undo_batch", batch_id: "batch" }} />);
  fireEvent.click(screen.getByRole("button", { name: "预览：撤销本批新增人物关系" }));
  expect(await screen.findByText(/保留本批已人工调整的 2/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "确认撤销本批新增人物关系" })).toBeDisabled();
});
it("previews both identities and retains the merge target name", async () => {
  api.peopleCorrectionPreview.mockResolvedValue({ ...plan, selection: { action: "merge", person_id: "person", target_id: "target" }, people: [...plan.people, { person_id: "target", label: "妈妈", members: [{ ...face, photo_id: "target-photo" }] }] });
  render(<PeopleCorrection selection={{ action: "merge", person_id: "person", target_id: "target" }} />);
  fireEvent.click(screen.getByRole("button", { name: "预览：合并到所选人物" })); await screen.findByText(/保留目标人物的称呼：妈妈/);
  expect(screen.getAllByRole("button", { name: "模拟照片加载成功" })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: "模拟照片加载成功" })[0]); expect(screen.getByRole("button", { name: "确认合并到所选人物" })).toBeDisabled();
});
