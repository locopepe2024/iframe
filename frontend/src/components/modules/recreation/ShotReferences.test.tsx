import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ShotReferences from './ShotReferences';
import { recreationApi, RecreationProject, RecreationMedia } from '@/lib/recreation';

vi.mock('@/lib/recreation', async original => ({ ...await original<typeof import('@/lib/recreation')>(), recreationApi: { models: vi.fn(), media: vi.fn(), searchMedia: vi.fn(), bindShot: vi.fn(), uploadImage: vi.fn(), generationPlan: vi.fn(), createKeyframeTask: vi.fn(), keyframeTask: vi.fn(), keyframeTasks: vi.fn(), generationTasks: vi.fn(), assemblyTasks: vi.fn() } }));
vi.mock('next/dynamic', () => ({ default: () => ({ onSave }: { onSave: (file: File) => Promise<void> }) => <button onClick={() => void onSave(new File(['edited'], 'edited.png', { type: 'image/png' }))}>export edit</button> }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
const image: RecreationMedia = { media_id: 'image', project_id: 'p', kind: 'evidence_frame', display_name: 'Evidence', storage_path: '/image.png', sha256: 'hash', created_at: 1, metadata: {} };
const project = { id: 'p', revision: 4, analysis_id: 'a', status: 'confirmed', analysis: { start_pts: 0, time_base: '1/24' }, timeline: { cuts: [], shots: [{ id: 'shot', start_pts: 0, end_pts: 24 }] } } as unknown as RecreationProject;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(recreationApi.models).mockResolvedValue({ provider: 'uniart', source: 'static', defaults: { image_model: 'uniart/gpt-image-2', video_model: 'uniart/minimax-h3-vip' }, image_models: [{ id: 'uniart/gpt-image-2', display_name: 'GPT Image 2', capabilities: ['i2i'] }], video_models: [{ id: 'uniart/minimax-h3-vip', display_name: 'MiniMax H3', capabilities: ['r2v'] }] }); vi.mocked(recreationApi.media).mockResolvedValue(image); vi.mocked(recreationApi.searchMedia).mockResolvedValue({ items: [image], next_cursor: null }); vi.mocked(recreationApi.keyframeTasks).mockResolvedValue([]); vi.mocked(recreationApi.generationTasks).mockResolvedValue([]); vi.mocked(recreationApi.assemblyTasks).mockResolvedValue([]); });

it('selects a stable media ID and saves only on explicit action, retaining draft after failure', async () => {
  const onSaved = vi.fn();
  vi.mocked(recreationApi.bindShot).mockRejectedValueOnce(new Error('conflict')).mockResolvedValue(project);
  render(<ShotReferences project={project} disabled={false} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'save' })).toBeEnabled());
  fireEvent.click(screen.getAllByRole('button', { name: 'choose' })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Evidence' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'instruction' }), { target: { value: 'Replace yellow box' } });
  expect(recreationApi.bindShot).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: 'instruction' })).toHaveValue('Replace yellow box');
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(project));
  expect(recreationApi.bindShot).toHaveBeenLastCalledWith(project, 'shot', { reference_media_id: 'image', replacement_media_id: null, instruction: 'Replace yellow box', description: '', instruction_refs: [] });
});

it('loads saved references and prevents writes while timeline cuts are unsaved', async () => {
  const saved = { ...project, timeline: { ...project.timeline!, shots: [{ ...project.timeline!.shots[0], reference_media_id: 'image' }] } };
  render(<ShotReferences project={saved} disabled onSaved={vi.fn()} />);
  expect(await screen.findByAltText('reference')).toHaveAttribute('src', expect.stringContaining('/image.png'));
  expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
  expect(screen.getByText('confirmFirst')).toBeInTheDocument();
});

it('registers an uploaded replacement without silently binding it', async () => {
  vi.mocked(recreationApi.uploadImage).mockResolvedValue({ ...image, kind: 'replacement_image' });
  render(<ShotReferences project={project} disabled={false} onSaved={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'save' })).toBeEnabled());
  const file = new File(['image'], 'product.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('replacement upload'), { target: { files: [file] } });
  await screen.findByAltText('replacement');
  expect(recreationApi.uploadImage).toHaveBeenCalledWith('p', file, 'replacement_image', undefined);
  expect(recreationApi.bindShot).not.toHaveBeenCalled();
});

it('exports reference edits as a new child media record before explicit binding', async () => {
  vi.mocked(recreationApi.uploadImage).mockResolvedValue({ ...image, media_id: 'edited', display_name: 'Edited', kind: 'reference_image' });
  const saved = { ...project, timeline: { ...project.timeline!, shots: [{ ...project.timeline!.shots[0], reference_media_id: 'image' }] } };
  render(<ShotReferences project={saved} disabled={false} onSaved={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'export edit' }));
  await screen.findByText('Edited');
  expect(recreationApi.uploadImage).toHaveBeenCalledWith('p', expect.any(File), 'reference_image', 'image');
  expect(recreationApi.bindShot).not.toHaveBeenCalled();
});

it('runs a paid keyframe task and selects its output without binding it', async () => {
  const replacement = { ...image, media_id: 'product', kind: 'replacement_image' as const, display_name: 'Product' };
  const corrected = { ...image, media_id: 'corrected', kind: 'reference_image' as const, display_name: 'Corrected' };
  vi.mocked(recreationApi.createKeyframeTask).mockResolvedValue({ task_id: 'task', status: 'pending', output_media: null, error: null });
  vi.mocked(recreationApi.keyframeTask).mockResolvedValue({ task_id: 'task', status: 'completed', output_media: corrected, error: null });
  render(<ShotReferences project={project} disabled={false} onSaved={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'save' })).toBeEnabled());
  fireEvent.click(screen.getAllByRole('button', { name: 'choose' })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Evidence' }));
  vi.mocked(recreationApi.searchMedia).mockResolvedValue({ items: [replacement], next_cursor: null });
  fireEvent.click(screen.getAllByRole('button', { name: 'choose' })[1]);
  fireEvent.change(screen.getByRole('combobox', { name: 'kind' }), { target: { value: 'replacement_image' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Product' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'instruction' }), { target: { value: 'Keep hand occlusion' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'keyframeAcceptCost' }));
  fireEvent.click(screen.getByRole('button', { name: 'generateCorrected' }));
  expect(await screen.findByText('Corrected')).toBeInTheDocument();
  expect(recreationApi.createKeyframeTask).toHaveBeenCalledWith(project, 'shot', 'image', 'product', 'Keep hand occlusion', true, 'uniart/gpt-image-2');
  expect(recreationApi.bindShot).not.toHaveBeenCalled();
});

it('restores the latest completed keyframe output after a reload', async () => {
  const corrected = { ...image, media_id: 'corrected', kind: 'reference_image' as const, display_name: 'Restored corrected' };
  vi.mocked(recreationApi.keyframeTasks).mockResolvedValue([{ task_id: 'task', project_id: 'p', shot_id: 'shot', revision: 4, analysis_id: 'a', status: 'completed', output_media: corrected, error: null }]);
  render(<ShotReferences project={project} disabled={false} onSaved={vi.fn()} />);
  expect(await screen.findByText('Restored corrected')).toBeInTheDocument();
  expect(recreationApi.keyframeTasks).toHaveBeenCalledWith('p', 'shot');
});

it('does not restore a keyframe from an older timeline revision', async () => {
  const stale = { ...image, media_id: 'stale', kind: 'reference_image' as const, display_name: 'Stale corrected' };
  vi.mocked(recreationApi.keyframeTasks).mockResolvedValue([{ task_id: 'stale-task', project_id: 'p', shot_id: 'shot', revision: 3, analysis_id: 'old-analysis', status: 'completed', output_media: stale, error: null }]);
  render(<ShotReferences project={{ ...project, revision: 4, analysis_id: 'a' }} disabled={false} onSaved={vi.fn()} />);
  await waitFor(() => expect(recreationApi.keyframeTasks).toHaveBeenCalledWith('p', 'shot'));
  expect(screen.queryByText('Stale corrected')).not.toBeInTheDocument();
});

it('shows the persisted keyframe failure after a reload', async () => {
  vi.mocked(recreationApi.keyframeTasks).mockResolvedValue([{ task_id: 'failed-task', project_id: 'p', shot_id: 'shot', revision: 4, analysis_id: 'a', status: 'failed', output_media: null, error: 'provider rejected the request' }]);
  render(<ShotReferences project={project} disabled={false} onSaved={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('provider rejected the request');
});

it('restores the latest generation task group after a reload', async () => {
  vi.mocked(recreationApi.generationTasks).mockResolvedValue([{ task_id: 'generation-task', generation_id: 'generation', project_id: 'p', shot_id: 'shot', shot_number: 1, revision: 4, analysis_id: 'a', status: 'completed', model: 'uniart/minimax-h3-vip', duration: 5, generate_audio: false, output_media: null, error: null, created_at: 10 }]);
  render(<ShotReferences project={project} disabled={false} onSaved={vi.fn()} />);
  expect(await screen.findByText(/generationStatus\.completed/)).toBeInTheDocument();
  expect(recreationApi.generationTasks).toHaveBeenCalledWith('p');
});

it('shows saved-plan blockers and clears the preview when revision changes', async () => {
  vi.mocked(recreationApi.generationPlan).mockResolvedValue({ revision: 4, ready: false, blockers: [{ shot_id: 'shot', shot_number: 1, reasons: ['description_required'] }], shots: [] });
  const view = render(<ShotReferences project={project} disabled={false} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'checkPlan' }));
  await screen.findByText('planBlocked');
  expect(screen.getByText(/description_required/)).toBeInTheDocument();
  view.rerender(<ShotReferences project={{ ...project, revision: 5 }} disabled={false} onSaved={vi.fn()} />);
  expect(screen.queryByText('planBlocked')).not.toBeInTheDocument();
});

it('passes explicit sound and generation duration and invalidates changed plans', async () => {
  vi.mocked(recreationApi.generationPlan).mockResolvedValue({ revision: 4, ready: true, blockers: [], shots: [] });
  render(<ShotReferences project={project} disabled={false} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'audioPolicy' }), { target: { value: 'generated' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'soundRequirements' }), { target: { value: 'Footsteps only' } });
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'checkPlan' }));
  await screen.findByText('planReady');
  expect(recreationApi.generationPlan).toHaveBeenCalledWith(project, 'uniart/minimax-h3-vip', {
    audio_policy: 'generated', soundscape: 'Footsteps only', generation_durations: { shot: 5 },
  });
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '6' } });
  expect(screen.queryByText('planReady')).not.toBeInTheDocument();
});
