import { act, fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EditingPage, { EditingMaterials, EditingMaterialManager } from './EditingPage';
import { editing, type EditProject, type EditMaterial } from '@/lib/editing';
import { agentRequest, agentTranscribe } from '@/lib/api';
import type { AssemblyEditPlan } from '@/lib/api';
import { requestEditingNavigation } from '@/lib/editingNavigationGuard';
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), agentRequest: vi.fn(), agentTranscribe: vi.fn() }));
vi.mock('../cast/VoicePickerModal', () => ({ default: ({ isOpen, onApply }: { isOpen: boolean; onApply: (id: string, name: string) => void }) => isOpen ? <button type="button" onClick={() => onApply('uniart:speech-2.8-hd:male-qn-qingse', 'Qingse')}>Pick Qingse</button> : null }));
vi.mock('@/lib/editing', () => ({ editing: { folders: vi.fn(), createFolder: vi.fn(), renameFolder: vi.fn(), deleteFolder: vi.fn(), moveMaterial: vi.fn(), deleteMaterial: vi.fn(), list: vi.fn(), create: vi.fn(), delete: vi.fn(), get: vi.fn(), materials: vi.fn(), material: vi.fn(), upload: vi.fn(), importMaterial: vi.fn(), save: vi.fn(), render: vi.fn(), versions: vi.fn(), restore: vi.fn(), subtitles: vi.fn(), transcriptionAudio: vi.fn(), synthesizeVoice: vi.fn(), voiceClones: vi.fn(), cloneVoice: vi.fn() } }));
const project: EditProject = { id: 'independent', title: 'My edit', revision: 0, plan: null, sources: {}, output: null };
const material: EditMaterial = { id: 'core:source', name: 'Original.mp4', url: '/video.mp4', sha256: 'digest', duration_ms: 1000, video: true, audio: true, origin: 'upload', deletable: true };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.mocked(editing.folders).mockResolvedValue([]);
  vi.mocked(editing.voiceClones).mockResolvedValue([]);
  vi.mocked(editing.list).mockResolvedValue([project]);
  vi.mocked(editing.get).mockResolvedValue(project);
  vi.mocked(editing.create).mockResolvedValue(project);
  vi.mocked(editing.materials).mockResolvedValue({ items: [material], next_cursor: null });
  vi.mocked(editing.material).mockResolvedValue(material);
  vi.mocked(editing.upload).mockResolvedValue(material);
  vi.mocked(editing.importMaterial).mockImplementation(async (_id, revision) => ({ ...project, revision: revision + 1, sources: { [material.id]: material } }));
  vi.mocked(editing.save).mockImplementation(async (_id, revision, plan) => ({ ...project, revision: revision + 1, plan, sources: { [material.id]: material } }));
  vi.mocked(editing.render).mockImplementation(async (_id, revision) => ({ ...project, revision, output: { url: '/result.mp4', revision } }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); window.location.hash = ''; });

async function openDirtyTimeline() {
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to edit Original.mp4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit clip 1: Original.mp4' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Playhead (seconds)' }), { target: { value: '0.5' } });
}

it('focuses Stay in a native leave dialog and restores focus without losing the draft', async () => {
  await openDirtyTimeline();
  const trigger = screen.getByRole('button', { name: 'Save edit' });
  trigger.focus();
  expect(requestEditingNavigation('#/library')).toBe(true);
  const dialog = await screen.findByRole('dialog', { name: 'Leave editing?' });
  expect(dialog.tagName).toBe('DIALOG');
  expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog', { name: 'Leave editing?' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(screen.getByText(/Unsaved/)).toBeInTheDocument();
});

it('focuses voiceover text and restores the trigger when its native dialog is canceled', async () => {
  await openDirtyTimeline();
  const trigger = screen.getByRole('button', { name: 'Generate voiceover' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Generate voiceover' });
  expect(dialog.tagName).toBe('DIALOG');
  expect(screen.getByRole('textbox', { name: 'Voiceover text' })).toHaveFocus();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog', { name: 'Generate voiceover' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('keeps the voiceover dialog open while synthesis is in progress', async () => {
  let finish!: (item: EditMaterial) => void;
  vi.mocked(editing.synthesizeVoice).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await openDirtyTimeline();
  fireEvent.click(screen.getByRole('button', { name: 'Generate voiceover' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Voiceover text' }), { target: { value: 'Hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose voice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pick Qingse' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate voiceover preview' }));
  const dialog = screen.getByRole('dialog', { name: 'Generate voiceover' });
  expect(dialog.tagName).toBe('DIALOG');
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(dialog).toBeInTheDocument();
  await act(async () => finish({ ...material, id: 'core:voice', video: false, audio: true }));
  expect(await screen.findByLabelText('Generated voiceover preview')).toBeInTheDocument();
});

it('cancels the nested voice picker before the parent voiceover dialog', async () => {
  await openDirtyTimeline();
  fireEvent.click(screen.getByRole('button', { name: 'Generate voiceover' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Voiceover text' }), { target: { value: 'Keep this draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose voice' }));
  const dialog = screen.getByRole('dialog', { name: 'Generate voiceover' });
  expect(screen.getByRole('button', { name: 'Pick Qingse' })).toBeInTheDocument();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('button', { name: 'Pick Qingse' })).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Voiceover text' })).toHaveValue('Keep this draft');
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog', { name: 'Generate voiceover' })).not.toBeInTheDocument();
});

it('restores focus after canceling the native transcription dialog', async () => {
  vi.mocked(agentRequest).mockResolvedValue({ available: false });
  await openDirtyTimeline();
  const trigger = screen.getByRole('button', { name: 'Source audio to captions' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Source audio to captions' });
  expect(dialog.tagName).toBe('DIALOG');
  expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog', { name: 'Source audio to captions' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(screen.getByText(/Unsaved/)).toBeInTheDocument();
});

it('keeps the draft when leaving is canceled, and discards it only after confirmation', async () => {
  await openDirtyTimeline();
  expect(requestEditingNavigation('#/library')).toBe(true);
  expect(await screen.findByRole('dialog', { name: 'Leave editing?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  expect(screen.queryByRole('dialog', { name: 'Leave editing?' })).not.toBeInTheDocument();
  expect(screen.getByText(/Unsaved/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save edit' })).toBeEnabled();

  expect(requestEditingNavigation('#/library')).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Discard and leave' }));
  await waitFor(() => expect(window.location.hash).toBe('#/library'));
});

it('keeps an unsaved draft when switching to the internal materials tab', async () => {
  await openDirtyTimeline();
  fireEvent.click(screen.getByRole('button', { name: 'Materials' }));
  expect(await screen.findByText(/Manage uploaded materials/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Editing' }));
  expect(screen.getByText(/Unsaved/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Leave editing?' })).not.toBeInTheDocument();
});

it('saves before leaving and keeps the dialog and draft available after save failure', async () => {
  vi.mocked(editing.save).mockRejectedValueOnce(new Error('Save unavailable'));
  await openDirtyTimeline();
  expect(requestEditingNavigation('#/settings')).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Save and leave' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
  expect(screen.getByRole('dialog', { name: 'Leave editing?' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save edit' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Save and leave' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(window.location.hash).toBe('#/settings'));
});

it('waits for an in-flight save before continuing a requested leave', async () => {
  let finishSave!: (value: EditProject) => void;
  vi.mocked(editing.save).mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
  await openDirtyTimeline();
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledOnce());
  expect(requestEditingNavigation('#/director')).toBe(true);
  await screen.findByRole('dialog', { name: 'Leave editing?' });
  expect(screen.getByRole('button', { name: 'Discard and leave' })).toBeDisabled();
  const submitted = vi.mocked(editing.save).mock.calls[0][2];
  await act(async () => finishSave({ ...project, revision: 1, plan: submitted, sources: { [material.id]: material } }));
  await waitFor(() => expect(window.location.hash).toBe('#/director'));
  expect(screen.queryByRole('dialog', { name: 'Leave editing?' })).not.toBeInTheDocument();
});

it('blocks custom shortcuts during save and render, then allows new edits and undo', async () => {
  let finishSave!: (project: EditProject) => void;
  vi.mocked(editing.save).mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
  await openDirtyTimeline();
  const workbench = screen.getByRole('region', { name: 'Multitrack editing' });
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledOnce());
  for (const key of ['s', 'Delete', 'Backspace']) fireEvent.keyDown(workbench, { key });
  expect(screen.getByRole('button', { name: 'Edit clip 1: Original.mp4' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit clip 2: Original.mp4' })).not.toBeInTheDocument();
  const submitted = vi.mocked(editing.save).mock.calls[0][2];
  const saved = { ...project, revision: 2, plan: submitted, sources: { [material.id]: material } };
  await act(async () => finishSave(saved));
  expect(screen.getByRole('button', { name: 'Save edit' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  let finishRender!: (project: EditProject) => void;
  vi.mocked(editing.render).mockImplementationOnce(() => new Promise(resolve => { finishRender = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
  for (const key of ['s', 'Delete']) fireEvent.keyDown(workbench, { key });
  expect(screen.getByRole('button', { name: 'Edit clip 1: Original.mp4' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit clip 2: Original.mp4' })).not.toBeInTheDocument();
  await act(async () => finishRender(saved));
  fireEvent.keyDown(workbench, { key: 's' });
  expect(screen.getByRole('button', { name: 'Edit clip 2: Original.mp4' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.queryByRole('button', { name: 'Edit clip 2: Original.mp4' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledTimes(2));
  expect(vi.mocked(editing.save).mock.calls[1][1]).toBe(2);
  expect(vi.mocked(editing.save).mock.calls[1][2].lanes[0].clips).toHaveLength(2);
});

it('retains the draft and undo history after a failed save, and unlocks for retry', async () => {
  let failSave!: (error: Error) => void;
  vi.mocked(editing.save).mockImplementationOnce(() => new Promise((_resolve, reject) => { failSave = reject; }));
  await openDirtyTimeline();
  const workbench = screen.getByRole('region', { name: 'Multitrack editing' });
  fireEvent.keyDown(workbench, { key: 's' });
  expect(screen.getByRole('button', { name: 'Edit clip 2: Original.mp4' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  for (const key of ['s', 'Delete']) fireEvent.keyDown(workbench, { key });
  await act(async () => failSave(new Error('Save failed')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
  expect(screen.getByRole('button', { name: 'Edit clip 1: Original.mp4' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit clip 2: Original.mp4' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save edit' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.queryByRole('button', { name: 'Edit clip 2: Original.mp4' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledTimes(2));
  expect(vi.mocked(editing.save).mock.calls[1][2]).toEqual(vi.mocked(editing.save).mock.calls[0][2]);
});

it.each(['start', 'end'] as const)('undoes an audio %s edge gesture and preserves the crop after saving and reopening', async edge => {
  const audio = { ...material, id: 'audio', name: 'Music.wav', video: false, duration_ms: 10000 };
  const original: AssemblyEditPlan = { id: 'edit', scope: 'project', revision: 1, target_duration_ms: 6000, markers: [], provenance: {}, lanes: [
    { id: 'video', kind: 'video', allow_overlap: false, clips: [{ id: 'video', source_media_id: material.id, timeline_start_ms: 0, timeline_end_ms: 6000, source_start_ms: 0, source_end_ms: 6000, source_refs: [], enabled: true }] },
    { id: 'audio', kind: 'bgm', allow_overlap: true, clips: [{ id: 'music', label: audio.name, source_media_id: audio.id, timeline_start_ms: 1000, timeline_end_ms: 4000, source_start_ms: 5000, source_end_ms: 8000, source_refs: [], enabled: true }] },
  ] };
  const sources = { [material.id]: { ...material, duration_ms: 6000 }, [audio.id]: audio };
  vi.mocked(editing.get).mockResolvedValue({ ...project, plan: original, sources });
  vi.mocked(editing.save).mockImplementation(async (_id, revision, plan) => ({ ...project, revision: revision + 1, plan, sources }));
  const view = render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  const clip = await screen.findByRole('button', { name: audio.name });
  fireEvent.click(clip);
  const handle = screen.getByRole('button', { name: `${audio.name} ${edge} handle` });
  handle.setPointerCapture = vi.fn();
  const track = screen.getByLabelText('bgm timeline');
  Object.defineProperty(track, 'clientWidth', { value: 600 });
  const pointer = (target: Element, type: string, x: number) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, { clientX: { value: x }, pointerId: { value: 1 }, button: { value: 0 } });
    fireEvent(target, event);
  };
  pointer(handle, 'pointerdown', edge === 'start' ? 100 : 400);
  pointer(track, 'pointermove', 250);
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  pointer(track, 'pointermove', 200);
  pointer(track, 'pointerup', 200);
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  expect(clip.style.left).toBe(`${1000 / 6000 * 100}%`);
  expect(clip.style.width).toBe('50%');
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledOnce());
  const saved = vi.mocked(editing.save).mock.calls[0][2];
  const expected = edge === 'start'
    ? { timeline_start_ms: 2000, timeline_end_ms: 4000, source_start_ms: 6000, source_end_ms: 8000 }
    : { timeline_start_ms: 1000, timeline_end_ms: 2000, source_start_ms: 5000, source_end_ms: 6000 };
  expect(saved.lanes[1].clips[0]).toMatchObject(expected);
  expect(saved.lanes[0]).toEqual(original.lanes[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Render MP4' })).toBeEnabled());
  view.unmount();
  vi.mocked(editing.get).mockResolvedValue({ ...project, revision: 1, plan: saved, sources });
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: audio.name }));
  expect(screen.getByRole('spinbutton', { name: 'Source in (seconds)' })).toHaveValue(expected.source_start_ms / 1000);
  expect(screen.getByRole('spinbutton', { name: 'Source out (seconds)' })).toHaveValue(expected.source_end_ms / 1000);
  expect(screen.getByRole('button', { name: 'Save edit' })).toBeDisabled();
});

it('reviews recognized text and estimated times before adding a subtitle lane', async () => {
  vi.mocked(agentRequest).mockResolvedValue({ available: true });
  vi.mocked(agentTranscribe).mockResolvedValue({ text: 'First. Second.', model: 'asr' });
  vi.mocked(editing.transcriptionAudio).mockResolvedValue(new Blob(['RIFFaudio'], { type: 'audio/wav' }));
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to edit Original.mp4' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit clip 1: Original.mp4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Source audio to captions' }));
  expect(screen.getByRole('button', { name: 'Add caption track' })).toBeDisabled();
  fireEvent.click(await screen.findByRole('button', { name: 'Transcribe selected clip' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Caption 1' })).toHaveValue('First.'));
  expect(editing.transcriptionAudio).toHaveBeenCalledWith(material.id, 0, 1000);
  fireEvent.change(screen.getByRole('textbox', { name: 'Caption 1' }), { target: { value: 'Corrected.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add caption track' }));
  expect(screen.queryByRole('dialog', { name: 'Source audio to captions' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledOnce());
  const lane = vi.mocked(editing.save).mock.calls[0][2].lanes.find(item => item.kind === 'subtitle');
  expect(lane?.clips.map(item => item.text)).toEqual(['Corrected.', 'Second.']);
});

it('previews a generated voiceover without changing the draft, then places it at the selected time', async () => {
  const voiceover = { ...material, id: 'core:voiceover', name: 'voiceover.mp3', video: false, audio: true, duration_ms: 500 };
  vi.mocked(editing.synthesizeVoice).mockResolvedValue(voiceover);
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to edit Original.mp4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save edit' })).toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Generate voiceover' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Voiceover text' }), { target: { value: 'Hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose voice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pick Qingse' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate voiceover preview' }));
  await waitFor(() => expect(editing.synthesizeVoice).toHaveBeenCalledWith('Hello', 'uniart:speech-2.8-hd:male-qn-qingse', 1));
  expect(await screen.findByLabelText('Generated voiceover preview')).toBeInTheDocument();
  expect(screen.getByText('0.50s')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save edit' })).toBeDisabled();
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Placement start (seconds)' }), { target: { value: '0.25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add to dialogue track' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Generate voiceover' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledTimes(2));
  const lane = vi.mocked(editing.save).mock.calls[1][2].lanes.find(item => item.kind === 'dialogue');
  expect(lane?.clips[0]).toMatchObject({ source_media_id: voiceover.id, timeline_start_ms: 250, timeline_end_ms: 750, source_start_ms: 0, source_end_ms: 500 });
});

it('requires explicit confirmation before trimming an overlong generated voiceover', async () => {
  const voiceover = { ...material, id: 'core:long-voiceover', name: 'long-voiceover.mp3', video: false, audio: true, duration_ms: 1500 };
  vi.mocked(editing.synthesizeVoice).mockResolvedValue(voiceover);
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to edit Original.mp4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate voiceover' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Voiceover text' }), { target: { value: 'Hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose voice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pick Qingse' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate voiceover preview' }));
  await screen.findByLabelText('Generated voiceover preview');
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Placement start (seconds)' }), { target: { value: '0.2' } });
  expect(screen.getByText(/Only 0.80s remain.*0.70s will be trimmed/)).toBeInTheDocument();
  const addButton = screen.getByRole('button', { name: 'Trim as confirmed and add to dialogue' });
  expect(addButton).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm trimming the stated voiceover tail' }));
  expect(addButton).toBeEnabled();
  fireEvent.click(addButton);
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledOnce());
  const lane = vi.mocked(editing.save).mock.calls[0][2].lanes.find(item => item.kind === 'dialogue');
  expect(lane?.clips[0]).toMatchObject({ source_media_id: voiceover.id, timeline_start_ms: 200, timeline_end_ms: 1000, source_start_ms: 0, source_end_ms: 800 });
});

it('creates a cloned voice and uses it for dialogue', async () => {
  const voiceover = { ...material, id: 'core:cloned-voiceover', name: 'voiceover.mp3', video: false, audio: true };
  const clone = { id: 'uniart:speech-2.8-hd:iframe1234567890abcdef1234567890abcdef', name: 'Narrator', model: 'speech-2.8-hd', created_at: 1, family: 'minimax' as const, origin: 'clone' as const };
  vi.mocked(editing.cloneVoice).mockResolvedValue(clone);
  vi.mocked(editing.synthesizeVoice).mockResolvedValue(voiceover);
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to edit Original.mp4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate voiceover' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Voiceover text' }), { target: { value: 'Hello' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Voice name' }), { target: { value: clone.name } });
  const sample = new File(['RIFFxxxxWAVEdata'], 'sample.wav', { type: 'audio/wav' });
  fireEvent.change(screen.getByLabelText('Recording sample'), { target: { files: [sample] } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have permission from the speaker to clone this voice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create cloned voice' }));
  await waitFor(() => expect(editing.cloneVoice).toHaveBeenCalledWith(sample, clone.name, true));
  fireEvent.click(screen.getByRole('button', { name: 'Generate voiceover preview' }));
  await waitFor(() => expect(editing.synthesizeVoice).toHaveBeenCalledWith('Hello', clone.id, 1));
  expect(await screen.findByLabelText('Generated voiceover preview')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Voiceover text' }), { target: { value: 'Hello again' } });
  expect(screen.queryByLabelText('Generated voiceover preview')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Generate voiceover preview' }));
  await waitFor(() => expect(editing.synthesizeVoice).toHaveBeenLastCalledWith('Hello again', clone.id, 1));
});

it('adds multiple clips and an audio lane over HTTP without crypto.randomUUID', async () => {
  vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to edit Original.mp4' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save edit' })).toBeEnabled());
  if (!screen.queryByRole('button', { name: 'Add to edit Original.mp4' })) fireEvent.click(screen.getByRole('button', { name: 'Toggle material panel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add to edit Original.mp4' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Add to edit Original.mp4' }));
  await waitFor(() => expect(editing.material).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add to edit Original.mp4' })).toBeEnabled());
  fireEvent.click(screen.getByText('Track settings'));
  fireEvent.click(screen.getByRole('button', { name: 'Add Music' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledOnce());
  const plan = vi.mocked(editing.save).mock.calls[0][2];
  expect(plan.lanes[0].clips.map(c => [c.timeline_start_ms, c.timeline_end_ms])).toEqual([[0, 1000], [1000, 2000]]);
  expect(plan.lanes[1].kind).toBe('bgm');
  const ids = plan.lanes.flatMap(l => [l.id, ...l.clips.map(c => c.id)]);
  expect(new Set(ids).size).toBe(ids.length);
});

it('keeps a workspace import after reloading the project without inserting a clip', async () => {
  const imported = { ...project, revision: 1, sources: { [material.id]: material } };
  vi.mocked(editing.importMaterial).mockResolvedValue(imported);
  vi.mocked(editing.get).mockResolvedValueOnce(project).mockResolvedValueOnce(imported);
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  await waitFor(() => expect(editing.importMaterial).toHaveBeenCalledWith(project.id, 0, material.id));
  expect(await screen.findByText(/Revision 1/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add to edit Original.mp4' })).toBeInTheDocument();
  expect(editing.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reload / discard changes' }));
  await waitFor(() => expect(editing.get).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button', { name: 'Add to edit Original.mp4' })).toBeInTheDocument();
  expect(screen.getByText('Materials are in your workspace. Click + beside a material to add it to the timeline.')).toBeInTheDocument();
});

it('guides a revision-zero project through import and timeline insertion', async () => {
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  expect(await screen.findByText('The timeline is empty. Import a video into your workspace, then click + beside it to add it to the timeline.')).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Timeline ruler' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Import materials' }));
  expect(screen.getByRole('dialog', { name: 'Import from library' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Upload video, audio, or images')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  expect(await screen.findByText('Materials are in your workspace. Click + beside a material to add it to the timeline.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Timeline video preview')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add to edit Original.mp4' }));
  expect(await screen.findByLabelText('Timeline video preview')).toHaveAttribute('src', expect.stringContaining('video.mp4'));
});

it('keeps material management free of workspace import actions even with a project selected', async () => {
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  await screen.findByRole('button', { name: 'Import' });
  fireEvent.click(screen.getByRole('button', { name: 'Materials' }));
  await screen.findByText(material.name);
  expect(screen.queryByRole('button', { name: /Import to workspace/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Upload video, audio, or images')).toBeInTheDocument();
  expect(screen.getByLabelText('Move material Original.mp4')).toBeInTheDocument();
  expect(editing.importMaterial).not.toHaveBeenCalled();
});

it('allows closing the workspace picker without importing or changing the edit', async () => {
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save edit' })).toBeDisabled();
  expect(editing.importMaterial).not.toHaveBeenCalled();
});

it('keeps import errors in the picker and allows retrying', async () => {
  vi.mocked(editing.importMaterial).mockRejectedValueOnce(new Error('Import failed'));
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Import failed');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import to workspace Original.mp4' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Import to workspace Original.mp4' }));
  expect(await screen.findByRole('button', { name: 'Add to edit Original.mp4' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('uploads every selected material and keeps per-file failures visible after refreshing', async () => {
  const files = ['one.mp4', 'bad.mp4', 'two.mp4'].map(name => new File(['bytes'], name, { type: 'video/mp4' }));
  vi.mocked(editing.upload).mockResolvedValueOnce(material).mockRejectedValueOnce(new Error('Invalid video')).mockResolvedValueOnce({ ...material, id: 'two', name: 'two.mp4' });
  const onSelect = vi.fn();
  render(<EditingMaterialManager onSelect={onSelect} />);
  const upload = await screen.findByLabelText('Upload video, audio, or images');
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
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to edit Original.mp4' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save edit' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Render MP4' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledOnce());
  const plan = vi.mocked(editing.save).mock.calls[0][2];
  expect(plan.lanes[0].clips[0]).toMatchObject({ source_media_id: material.id, timeline_start_ms: 0, timeline_end_ms: 1000 });
  expect(plan.lanes[0].clips[0].source_project_id).toBeUndefined();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Render MP4' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
  await screen.findByRole('link', { name: 'Download output · v2' });
  expect(editing.render).toHaveBeenCalledWith(project.id, 2);
});

it('places an uploaded still image on the visual lane and previews the saved material', async () => {
  const still: EditMaterial = { ...material, id: 'core:still', name: 'Portrait.png', url: '/portrait.png', video: false, image: true, audio: false, duration_ms: 5000 };
  vi.mocked(editing.materials).mockResolvedValue({ items: [still], next_cursor: null });
  vi.mocked(editing.material).mockResolvedValue(still);
  vi.mocked(editing.importMaterial).mockResolvedValue({ ...project, revision: 1, sources: { [still.id]: still } });
  vi.mocked(editing.save).mockImplementation(async (_id, revision, plan) => ({ ...project, revision: revision + 1, plan, sources: { [still.id]: still } }));
  const { container } = render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Portrait.png' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to edit Portrait.png' }));
  expect(await screen.findByRole('button', { name: 'Edit clip 1: Portrait.png' })).toBeInTheDocument();
  expect(container.querySelector('[data-editing-preview] img')).toHaveAttribute('src', 'http://localhost:3000/files/portrait.png');
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledOnce());
  expect(vi.mocked(editing.save).mock.calls[0][2].lanes[0].clips[0]).toMatchObject({ source_media_id: still.id, timeline_start_ms: 0, timeline_end_ms: 5000 });
});

it('separates material management from the timeline and preserves unsaved edits across tabs', async () => {
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to edit Original.mp4' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save edit' })).toBeEnabled());
  expect(screen.queryByLabelText('Upload video, audio, or images')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Materials' }));
  expect(await screen.findByLabelText('Upload video, audio, or images')).toBeInTheDocument();
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
  await screen.findByText('Revision 2');
  fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Restore v1' }));
  await waitFor(() => expect(editing.restore).toHaveBeenCalledWith(project.id, 2, 1));
  await screen.findByText(/Revision 3/);
  expect(screen.queryByRole('dialog', { name: 'Version history' })).not.toBeInTheDocument();
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
  await waitFor(() => expect(editing.createFolder).toHaveBeenCalledWith(folder.name, null));
  expect(screen.getByRole('button', { name: 'Root' })).toBeInTheDocument();
  const upload = screen.getByLabelText('Upload video, audio, or images');
  await waitFor(() => expect(upload).toBeEnabled());
  const file = new File(['test'], 'clip.mp4', { type: 'video/mp4' });
  fireEvent.change(upload, { target: { files: [file] } });
  await waitFor(() => expect(editing.upload).toHaveBeenCalledWith(file, null));
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
  render(<EditingMaterialManager onSelect={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Next.mp4')).toBeInTheDocument();
  expect(editing.materials).toHaveBeenLastCalledWith('', 24, '__root');
});

it('navigates nested folders with a breadcrumb and scopes materials to the current level', async () => {
  vi.mocked(editing.folders).mockResolvedValue([
    { id: 'root-folder', name: 'Rushes', parent_id: null, created_at: 1 },
    { id: 'child-folder', name: 'Day 1', parent_id: 'root-folder', created_at: 2 },
  ]);
  vi.mocked(editing.materials).mockResolvedValue({ items: [], next_cursor: null });
  render(<EditingMaterialManager />);
  await screen.findByRole('button', { name: 'Rushes' });
  expect(screen.queryByRole('button', { name: 'Day 1' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Rushes' }));
  expect(await screen.findByRole('button', { name: 'Day 1' })).toBeInTheDocument();
  expect(editing.materials).toHaveBeenLastCalledWith('', 0, 'root-folder');
  fireEvent.click(screen.getByRole('button', { name: 'Day 1' }));
  await waitFor(() => expect(editing.materials).toHaveBeenLastCalledWith('', 0, 'child-folder'));
  expect(screen.getByRole('button', { name: 'Root' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Rushes' })).toBeInTheDocument();
});


it('shows only project materials in the workspace and opens the library through Import', async () => {
  const onImport = vi.fn();
  const onSelect = vi.fn();
  render(<EditingMaterials onImport={onImport} onSelect={onSelect} materials={{ [material.id]: material }} />);
  expect(screen.queryByRole('textbox', { name: 'Search materials' })).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Folder path' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Root' })).not.toBeInTheDocument();
  expect(editing.materials).not.toHaveBeenCalled();
  expect(editing.folders).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  expect(onImport).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Add to edit Original.mp4' }));
  expect(onSelect).toHaveBeenCalledWith(material);
});

it('hydrates a saved timeline source that is missing from the project snapshot', async () => {
  const saved = {
    ...project,
    plan: {
      id: 'assembly-independent', scope: 'project' as const, revision: 1, target_duration_ms: 1000,
      lanes: [{ id: 'video', kind: 'video' as const, allow_overlap: false, clips: [{ id: 'clip', source_media_id: material.id, timeline_start_ms: 0, timeline_end_ms: 1000, source_start_ms: 0, source_end_ms: 1000, enabled: true, source_refs: [] }] }],
      markers: [], provenance: {},
    },
  };
  vi.mocked(editing.get).mockResolvedValue(saved);
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  await waitFor(() => expect(editing.material).toHaveBeenCalledWith(material.id));
  expect(screen.queryByText('No video at this position. Select a shot on the timeline.')).not.toBeInTheDocument();
});


it('undoes and redoes a directional trim before saving the source interval', async () => {
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to edit Original.mp4' }));
  const playhead = await screen.findByRole('spinbutton', { name: 'Playhead (seconds)' });
  fireEvent.change(playhead, { target: { value: '0.4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Trim left' }));
  expect(screen.getByRole('slider', { name: 'Timeline playhead' })).toHaveAttribute('max', '600');
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByRole('slider', { name: 'Timeline playhead' })).toHaveAttribute('max', '1000');
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  expect(screen.getByRole('slider', { name: 'Timeline playhead' })).toHaveAttribute('max', '600');
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(editing.save).toHaveBeenCalledOnce());
  expect(vi.mocked(editing.save).mock.calls[0][2].lanes[0].clips[0]).toMatchObject({ source_start_ms: 400, source_end_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 600 });
});

it('names new projects on demand, cancels without changing the project, and retries creation errors', async () => {
  vi.mocked(editing.create).mockRejectedValueOnce(new Error('Create failed')).mockResolvedValueOnce({ ...project, id: 'second', title: 'Second edit' });
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  await screen.findByText('Revision 0');
  expect(screen.queryByRole('textbox', { name: 'New edit title' })).not.toBeInTheDocument();
  const actions = screen.getByRole('button', { name: 'Project actions' });
  actions.focus();
  fireEvent.click(actions);
  fireEvent.click(screen.getByRole('button', { name: 'New edit' }));
  const title = screen.getByRole('textbox', { name: 'New edit title' });
  expect(title).toHaveFocus();
  fireEvent.change(title, { target: { value: 'Cancelled edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(actions).toHaveFocus();
  expect(screen.getByRole('combobox', { name: 'Editing project' })).toHaveValue(project.id);
  expect(editing.create).not.toHaveBeenCalled();
  fireEvent.click(actions);
  fireEvent.click(screen.getByRole('button', { name: 'New edit' }));
  expect(screen.getByRole('textbox', { name: 'New edit title' })).toHaveValue('');
  fireEvent.change(screen.getByRole('textbox', { name: 'New edit title' }), { target: { value: '  Second edit  ' } });
  fireEvent.submit(screen.getByRole('textbox', { name: 'New edit title' }).closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('Create failed');
  expect(screen.getByRole('dialog', { name: 'New edit' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create independent project' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(editing.create).toHaveBeenNthCalledWith(2, 'Second edit');
  expect(screen.getByRole('combobox', { name: 'Editing project' })).toHaveValue('second');
});

it('dismisses project actions with Escape, outside press and focus leaving the disclosure', async () => {
  render(<EditingPage />);
  const trigger = screen.getByRole('button', { name: 'Project actions' });
  fireEvent.click(trigger);
  within(screen.getByRole('group', { name: 'Project actions' })).getByRole('button', { name: 'New edit' }).focus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('group', { name: 'Project actions' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('group', { name: 'Project actions' })).not.toBeInTheDocument();
  fireEvent.click(trigger);
  within(screen.getByRole('group', { name: 'Project actions' })).getByRole('button', { name: 'New edit' }).focus();
  fireEvent.focusOut(document.activeElement!, { relatedTarget: screen.getByRole('button', { name: 'Materials' }) });
  expect(screen.queryByRole('group', { name: 'Project actions' })).not.toBeInTheDocument();
});

it('blocks project replacement and history for an unsaved timeline while allowing discard', async () => {
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import to workspace Original.mp4' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to edit Original.mp4' }));
  expect(screen.getByRole('combobox', { name: 'Editing project' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
  for (const name of ['New edit', 'Version history', 'Delete project']) expect(screen.getByRole('button', { name })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reload / discard changes' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload / discard changes' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Editing project' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Save edit' })).toBeDisabled();
  expect(editing.create).not.toHaveBeenCalled();
  expect(editing.delete).not.toHaveBeenCalled();
  expect(editing.versions).not.toHaveBeenCalled();
});

it('retains deletion confirmation and leaves source materials untouched', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.mocked(editing.delete).mockResolvedValue({ id: project.id, deleted: true });
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  await screen.findByText('Revision 0');
  fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
  expect(editing.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Editing project' })).toHaveValue(''));
  expect(editing.delete).toHaveBeenCalledWith(project.id);
  expect(editing.deleteMaterial).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledTimes(2);
  confirm.mockRestore();
});

it('shows empty history in a dismissible dialog', async () => {
  vi.mocked(editing.versions).mockResolvedValue([]);
  render(<EditingPage />);
  await screen.findByRole('option', { name: project.title });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing project' }), { target: { value: project.id } });
  await screen.findByText('Revision 0');
  const trigger = screen.getByRole('button', { name: 'Project actions' });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
  expect(await screen.findByText('No saved versions yet')).toBeInTheDocument();
  fireEvent(screen.getByRole('dialog', { name: 'Version history' }), new Event('cancel', { bubbles: false, cancelable: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
