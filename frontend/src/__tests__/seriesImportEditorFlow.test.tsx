// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import messages from "../../messages/zh.json";
import ImportFileDialog from "@/components/series/ImportFileDialog";

const { createProject, importFilePreview, importFileConfirm, importDocument, saveDocument } = vi.hoisted(() => ({
  createProject: vi.fn(),
  importFilePreview: vi.fn(),
  importFileConfirm: vi.fn(),
  importDocument: vi.fn(),
  saveDocument: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: { createProject, importFilePreview, importFileConfirm } }));
vi.mock("@/lib/scriptEditorApi", () => ({ scriptEditorApi: { importDocument, saveDocument } }));
vi.mock("framer-motion", () => ({
  motion: { div: ({ children, initial, animate, exit, ...props }: any) => <div {...props}>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

function show(props: Record<string, unknown> = {}) {
  return render(
    <NextIntlClientProvider locale="zh" messages={messages}>
      <ImportFileDialog isOpen onClose={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "#/";
});

it("routes an uploaded DOCX through a saved editor draft before series analysis", async () => {
  createProject.mockResolvedValue({ id: "draft-1" });
  const content = { type: "doc", content: [{ type: "action", content: [{ type: "text", text: "第1集 开场" }] }] };
  importDocument.mockResolvedValue({ content });
  saveDocument.mockResolvedValue({ status: "ok" });
  show();

  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File(["docx bytes"], "sample.docx")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "导入剧本编辑器" }));

  await waitFor(() => expect(window.location.hash).toBe("#/project/draft-1/editor"));
  expect(createProject).toHaveBeenCalledWith("sample", "", true);
  expect(importDocument).toHaveBeenCalledWith("draft-1", expect.objectContaining({ name: "sample.docx" }));
  expect(saveDocument).toHaveBeenCalledWith("draft-1", content);
  expect(importFilePreview).not.toHaveBeenCalled();
});

it("previews the edited source when creating a series from the editor", async () => {
  importFilePreview.mockResolvedValue({ import_id: "import-1", episodes: [
    { episode_number: 1, title: "开场", summary: "甲到达" },
  ] });
  show({ initialText: "第1集 甲到达", initialTitle: "编辑稿" });

  fireEvent.click(screen.getByRole("button", { name: "解析并预览分集" }));

  await waitFor(() => expect(importFilePreview).toHaveBeenCalledTimes(1));
  expect(importFilePreview.mock.calls[0][0]).toEqual(expect.objectContaining({ name: "编辑稿.txt" }));
  expect(createProject).not.toHaveBeenCalled();
  expect(await screen.findByText("开场")).toBeInTheDocument();
});

it("requires source assignment review before creating episodes", async () => {
  importFilePreview.mockResolvedValue({ import_id: "import-1", episodes: [
    { episode_number: 1, title: "开场", summary: "甲到达" },
  ], assignments: [{ start_line: 1, end_line: 1, scope: "unassigned", episodes: [],
    preview: "甲到达", source: "甲到达" }] });
  importFileConfirm.mockResolvedValue({ series: { id: "series-1" }, episodes: [{ id: "episode-1" }] });
  show({ initialText: "甲到达", initialTitle: "编辑稿" });

  fireEvent.click(screen.getByRole("button", { name: "解析并预览分集" }));
  fireEvent.click(await screen.findByRole("button", { name: /确认创建/ }));
  expect(importFileConfirm).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("第 1 至 1 行归属"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: /确认创建/ }));
  await waitFor(() => expect(importFileConfirm).toHaveBeenCalledWith(expect.objectContaining({
    title: "编辑稿", import_id: "import-1",
    assignments: [expect.objectContaining({ scope: "episode", episodes: [1] })],
  })));
});
