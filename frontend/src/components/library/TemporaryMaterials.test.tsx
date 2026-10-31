import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TemporaryMaterials from './TemporaryMaterials';
const mocks = vi.hoisted(() => ({ inventory: vi.fn(), list: vi.fn(), save: vi.fn(), edit: vi.fn() }));
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@/lib/api', () => ({ API_URL: '' }));
vi.mock('@/lib/materialLibrary', () => ({ materialLibrary: mocks }));
vi.mock('../modules/playground/PlaygroundImageEditor', () => ({ default: ({ children }: any) => children, usePlaygroundImageEditor: () => mocks.edit }));
const temporary = { id: 'one', title: 'Original image', reference: '/playground/input-media/one.png', media_type: 'image', source_kind: 'editor_output', created_at: 1, proposed_expires_at: 604801, retention_state: 'legacy_review' };
const saved = { id: 'version1', asset_id: 'asset1', title: temporary.title, reference: temporary.reference, content_url: '/playground/material-library/version1/content', media_type: 'image', created_at: 2, retention_state: 'permanent' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.inventory.mockResolvedValue({ items: [temporary], diagnostics: [], next_offset: null });
  mocks.list.mockResolvedValue([]);
  mocks.save.mockResolvedValue(saved);
});
afterEach(cleanup);
it('explains paused expiry, promotes a temporary material and edits a saved exact version', async () => {
  render(<TemporaryMaterials />);
  await screen.findByText('Original image');
  expect(screen.getByText(/Automatic deletion is paused/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
  expect(mocks.edit).toHaveBeenCalledWith(temporary.reference, temporary.title);
  fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(temporary.reference, temporary.title));
  await screen.findByText('Saved to material library.');
  expect(screen.queryByRole('button', { name: 'Save to library' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Saved materials' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit new version' }));
  expect(mocks.edit).toHaveBeenLastCalledWith(saved.content_url, temporary.title);
});
it('keeps failed saves visible and retryable', async () => {
  mocks.save.mockRejectedValue(new Error('Disk unavailable'));
  render(<TemporaryMaterials />);
  fireEvent.click(await screen.findByRole('button', { name: 'Save to library' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Disk unavailable');
  expect(screen.getByRole('button', { name: 'Save to library' })).toBeEnabled();
});
