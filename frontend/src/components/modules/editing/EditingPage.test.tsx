import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EditingPage, { EditingMaterials, EditingMaterialManager } from './EditingPage';
import { editing, type EditProject, type EditMaterial } from '@/lib/editing';
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@/lib/editing', () => ({ editing: { folders: vi.fn(), createFolder: vi.fn(), renameFolder: vi.fn(), deleteFolder: vi.fn(), moveMaterial: vi.fn(), deleteMaterial: vi.fn(), list: vi.fn(), create: vi.fn(), get: vi.fn(), materials: vi.fn(), material: vi.fn(), upload: vi.fn(), save: vi.fn(), render: vi.fn(), versions: vi.fn(), restore: vi.fn(), subtitles: vi.fn() } }));
const project: EditProject = { id: 'independent', title: 'My edit', revision: 0, plan: null, sources: {}, output: null };
const material: EditMaterial = { id: 'core:source', name: 'Original.mp4', url: '/video.mp4', sha256: 'digest', duration_ms: 1000, video: true, audio: true, origin: 'upload', deletable: true };
beforeEach(() => {
  vi.mocked(editing.folders).mockResolvedValue([]);
  vi.mocked(editing.list).mockResolvedValue([project]);
  vi.mocked(editing.get).mockResolvedValue(project);
  vi.mocked(editing.create).mockResolvedValue(project);
  vi.mocked(editing.materials).mockResolvedValue({ items: [material], next_cursor: null });
  vi.mocked(editing.material).mockResolvedValue(material);
  vi.mocked(editing.upload).mockResolvedValue(material);
  vi.mocked(editing.save).mockImplementation(async (_id, revision, plan) => ({ ...project, revision: revision + 1, plan, sources: { [material.id]: material } }));
  vi.mocked(editing.render).mockImplementation(async () => ({ ...project, revision: 1, output: { url: '/result.mp4', revision: 1 } }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); window.location.hash = ''; });

it('adds multiple clips and an audio lane over HTTP without crypto.randomUUID', async () => {
  vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Select material' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save edit' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Material panel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Select material' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Select material' }));
  await waitFor(() => expect(editing.material).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Select material' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Add Music' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledOnce());
  const plan = vi.mocked(editing.save).mock.calls[0][2];
  expect(plan.lanes[0].clips.map(c => [c.timeline_start_ms, c.timeline_end_ms])).toEqual([[0, 1000], [1000, 2000]]);
  expect(plan.lanes[1].kind).toBe('bgm');
  const ids = plan.lanes.flatMap(l => [l.id, ...l.clips.map(c => c.id)]);
  expect(new Set(ids).size).toBe(ids.length);
});

it('uploads every selected material and keeps per-file failures visible after refreshing', async () => {
  const files = ['one.mp4', 'bad.mp4', 'two.mp4'].map(name => new File(['bytes'], name, { type: 'video/mp4' }));
  vi.mocked(editing.upload).mockResolvedValueOnce(material).mockRejectedValueOnce(new Error('Invalid video')).mockResolvedValueOnce({ ...material, id: 'two', name: 'two.mp4' });
  const onSelect = vi.fn();
  render(<EditingMaterialManager onSelect={onSelect} />);
  const upload = await screen.findByLabelText('Upload video or audio');
  await waitFor(() => expect(upload).toBeEnabled());
  expect(upload).toHaveAttribute('multiple');
  fireEvent.change(upload, { target: { files } });
  await waitFor(() => expect(editing.upload).toHaveBeenCalledTimes(3));
  expect(vi.mocked(editing.upload).mock.calls.map(call => call[0])).toEqual(files);
  await waitFor(() => expect(editing.materials).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('alert')).toHaveTextContent('bad.mp4');
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid video');
  expect(onSelect).not.toHaveBeenCalled();
});

it('references library media in an independent plan then saves and renders that revision', async () => {
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Select material' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save edit' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Render MP4' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledOnce());
  const plan = vi.mocked(editing.save).mock.calls[0][2];
  expect(plan.lanes[0].clips[0]).toMatchObject({ source_media_id: material.id, timeline_start_ms: 0, timeline_end_ms: 1000 });
  expect(plan.lanes[0].clips[0].source_project_id).toBeUndefined();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Render MP4' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
  await screen.findByRole('link', { name: 'Download output · v1' });
  expect(editing.render).toHaveBeenCalledWith(project.id, 1);
});

it('separates material management from the timeline and preserves unsaved edits across tabs', async () => {
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Select material' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save edit' })).toBeEnabled());
  expect(screen.queryByLabelText('Upload video or audio')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Materials' }));
  expect(await screen.findByLabelText('Upload video or audio')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save edit' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Editing' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save edit' })).toBeEnabled());
  expect(editing.save).not.toHaveBeenCalled();
});

it('restores a saved version with an optimistic current revision', async () => {
  vi.mocked(editing.versions).mockResolvedValue([{ revision: 2 }, { revision: 1 }]);
  vi.mocked(editing.get).mockResolvedValue({ ...project, revision: 2 });
  vi.mocked(editing.restore).mockResolvedValue({ ...project, revision: 3 });
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Version history' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Restore v1' }));
  await waitFor(() => expect(editing.restore).toHaveBeenCalledWith(project.id, 2, 1));
  await screen.findByText(/Revision 3/);
});

it('creates a folder, uploads into it, moves a material and reports deletion conflicts', async () => {
  const folder = { id: 'folder', name: 'Rushes', created_at: 1 };
  vi.mocked(editing.createFolder).mockResolvedValue(folder);
  vi.mocked(editing.folders).mockResolvedValue([folder]);
  vi.mocked(editing.deleteMaterial).mockRejectedValue(new Error('Material is referenced by a saved editing project or version'));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<EditingMaterialManager />);
  fireEvent.click(await screen.findByRole('button', { name: 'New folder' }));
  fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: folder.name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
  await waitFor(() => expect(editing.createFolder).toHaveBeenCalledWith(folder.name));
  await waitFor(() => expect(screen.getByLabelText('Material folder')).toHaveValue(folder.id));
  const upload = screen.getByLabelText('Upload video or audio');
  await waitFor(() => expect(upload).toBeEnabled());
  const file = new File(['test'], 'clip.mp4', { type: 'video/mp4' });
  fireEvent.change(upload, { target: { files: [file] } });
  await waitFor(() => expect(editing.upload).toHaveBeenCalledWith(file, folder.id));
  await waitFor(() => expect(screen.getByLabelText('Move material Original.mp4')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Move material Original.mp4'), { target: { value: folder.id } });
  await waitFor(() => expect(editing.moveMaterial).toHaveBeenCalledWith(material.id, folder.id));
  const remove = await screen.findByRole('button', { name: 'Delete material Original.mp4' });
  await waitFor(() => expect(remove).toBeEnabled());
  fireEvent.click(remove);
  expect(await screen.findByRole('alert')).toHaveTextContent('referenced by a saved');
  expect(screen.getByText(material.name)).toBeInTheDocument();
});

it('loads subsequent pages using the selected folder', async () => {
  vi.mocked(editing.materials).mockResolvedValueOnce({ items: [material], next_cursor: 24 }).mockResolvedValue({ items: [{ ...material, id: 'next', name: 'Next.mp4' }], next_cursor: null });
  render(<EditingMaterials onSelect={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Next.mp4')).toBeInTheDocument();
  expect(editing.materials).toHaveBeenLastCalledWith('', 24, null);
});
