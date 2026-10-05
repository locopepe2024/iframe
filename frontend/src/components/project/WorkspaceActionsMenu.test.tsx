import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import WorkspaceActionsMenu from "./WorkspaceActionsMenu";

it("opens project actions without activating its row and runs delete once", () => {
  const openProject = vi.fn();
  const deleteProject = vi.fn();
  render(
    <div onClick={openProject}>
      <WorkspaceActionsMenu label="Project actions" renameLabel="Rename" deleteLabel="Delete" onDelete={deleteProject} />
    </div>
  );

  fireEvent.click(screen.getByRole("button", { name: "Project actions" }));
  expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  expect(openProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(deleteProject).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(openProject).not.toHaveBeenCalled();
});

it("offers series rename and closes on Escape", () => {
  const renameSeries = vi.fn();
  render(<WorkspaceActionsMenu label="Series actions" renameLabel="Rename" deleteLabel="Delete"
    onRename={renameSeries} onDelete={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "Series actions" }));
  expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  expect(renameSeries).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Series actions" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
