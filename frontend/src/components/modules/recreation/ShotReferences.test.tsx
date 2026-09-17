import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ShotReferences from './ShotReferences';
import { recreationApi, RecreationProject, RecreationMedia } from '@/lib/recreation';

vi.mock('@/lib/recreation', async original => ({ ...await original<typeof import('@/lib/recreation')>(), recreationApi: { media: vi.fn(), searchMedia: vi.fn(), bindShot: vi.fn(), uploadImage: vi.fn() } }));
vi.mock('next/dynamic', () => ({ default: () => ({ onSave }: { onSave: (file: File) => Promise<void> }) => <button onClick={() => void onSave(new File(['edited'], 'edited.png', { type: 'image/png' }))}>export edit</button> }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
const image: RecreationMedia = { media_id: 'image', project_id: 'p', kind: 'evidence_frame', display_name: 'Evidence', storage_path: '/image.png', sha256: 'hash', created_at: 1, metadata: {} };
const project = { id: 'p', revision: 4, analysis_id: 'a', status: 'confirmed', analysis: { start_pts: 0, time_base: '1/24' }, timeline: { cuts: [], shots: [{ id: 'shot', start_pts: 0, end_pts: 24 }] } } as unknown as RecreationProject;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(recreationApi.media).mockResolvedValue(image); vi.mocked(recreationApi.searchMedia).mockResolvedValue({ items: [image], next_cursor: null }); });

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
  expect(recreationApi.bindShot).toHaveBeenLastCalledWith(project, 'shot', { reference_media_id: 'image', replacement_media_id: null, instruction: 'Replace yellow box' });
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
