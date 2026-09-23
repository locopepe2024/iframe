// @vitest-environment jsdom
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/en.json';
import CastWorkbenchModal, { activePolls, startAssetPoll } from '@/components/modules/cast/CastWorkbenchModal';
import { useProjectStore } from '@/store/projectStore';
import { api } from '@/lib/api';
Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{ top: 0, bottom: 1, left: 0, right: 1 }] });
Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 1, left: 0, right: 1 }) });
vi.mock('@/lib/api', () => ({ API_URL: '', api: { getStylePresets: vi.fn().mockResolvedValue([]), getProject: vi.fn(), getTaskStatus: vi.fn(), getAssetReferenceIndex: vi.fn(), listLibraryAssets: vi.fn(), generateAsset: vi.fn(), uploadAsset: vi.fn(), selectAssetVariant: vi.fn(), deleteAssetVariant: vi.fn(), updateAssetVariantMetadata: vi.fn(), favoriteAssetVariant: vi.fn() } }));
vi.mock('@/components/common/GroupedModelGrid', () => ({ default: () => null }));
vi.mock('@/components/shared/preview/PreviewImage', () => ({ default: ({ alt, clickToLightbox }: any) => <span onClick={clickToLightbox ? e => e.stopPropagation() : undefined}>{alt}</span> }));
const character = { id: 'char', name: 'Test', description: 'Person' };
const project: any = { id: 'project', title: 'Project', characters: [character], scenes: [], props: [] };
function show() { render(<NextIntlClientProvider locale="en" messages={messages}><CastWorkbenchModal isOpen kind="character" entityId="char" onClose={() => {}} /></NextIntlClientProvider>); }
function promptEditor() {
 return screen.getByRole('textbox') as HTMLElement & { editor: import('@tiptap/core').Editor };
}
function setPromptDocument(html: string) {
 act(() => { promptEditor().editor.commands.focus(); promptEditor().editor.commands.setContent(html); });
}
beforeEach(() => {
 cleanup();
 for (const poll of Array.from(activePolls.values())) clearInterval(poll);
 activePolls.clear();
 vi.useRealTimers();
 vi.clearAllMocks();
 vi.mocked(api.getAssetReferenceIndex).mockResolvedValue({ schema_version: 1, project_id: 'project', assets: [] });
 useProjectStore.setState({ currentProject: project, projects: [project], currentSeries: null, generatingTasks: [] });
});
it('merges the completed target snapshot and clears its marker without fetching the project', async () => {
 vi.useFakeTimers();
 const completedAsset = {
  ...character,
  reference_sheet: { image_variants: [{ id: 'generated', url: 'generated.png' }], selected_image_id: 'generated' },
  source: 'episode',
 };
 vi.mocked(api.getTaskStatus).mockResolvedValue({
  status: 'completed', script_id: 'project', asset_id: 'char', asset_type: 'character',
  asset_source: 'episode', asset: completedAsset,
 } as any);
 useProjectStore.setState({ generatingTasks: [{ assetId: 'char', generationType: 'reference_sheet', batchSize: 1 }] });
 const store = useProjectStore.getState();
 startAssetPoll('char', 'task', 'project', 'character', 'reference_sheet', ((key: string) => key) as any, () => ({
  updateProject: store.updateProject,
  removeGeneratingTask: store.removeGeneratingTask,
 }));

 await act(async () => { await vi.advanceTimersByTimeAsync(2500); });

 expect(useProjectStore.getState().currentProject?.characters).toEqual([completedAsset]);
 expect(useProjectStore.getState().generatingTasks).toEqual([]);
 expect(api.getProject).not.toHaveBeenCalled();
 expect(activePolls.has('char')).toBe(false);
 vi.useRealTimers();
});
it('keeps an uploaded image in the candidate pool until @ explicitly binds it', async () => {
 vi.mocked(api.generateAsset).mockResolvedValue(project as any);
 show();
 const input = screen.getByLabelText('Upload reference image');
 const file = new File(['image'], 'reference.png', { type: 'image/png' });
 vi.mocked(api.uploadAsset).mockResolvedValue({ ...project, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }], selected_image_id: 'one' } }] });
 fireEvent.change(input, { target: { files: [file] } });
 await waitFor(() => expect(screen.getByText('Test one')).toBeTruthy());
 expect(api.uploadAsset).toHaveBeenCalledWith('project', 'character', 'char', file, 'reference_sheet');
 fireEvent.click(screen.getByRole('button', { name: /Generate .*more/ }));
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 expect(vi.mocked(api.generateAsset).mock.calls[0][12]).toBeUndefined();
 expect(vi.mocked(api.generateAsset).mock.calls[0][13]).toEqual([]);
 expect(vi.mocked(api.generateAsset).mock.calls[0][14]).toBe('text');
 expect(vi.mocked(api.generateAsset).mock.calls[0][6]).not.toContain('@');
});

it('shows the Cast generation-description @ menu and submits only selected stable ids in order', async () => {
 const withLibrary = { ...project, scenes: [{ id: 'scene-1', name: 'Night train', description: 'Train' }], props: [{ id: 'prop-1', name: 'Pocket watch', description: 'Watch' }] };
 useProjectStore.setState({ currentProject: withLibrary, projects: [withLibrary] });
 vi.mocked(api.getProject).mockResolvedValue(withLibrary as any);
 vi.mocked(api.getAssetReferenceIndex).mockResolvedValue({
  schema_version: 1,
  project_id: 'project',
  assets: [
   { asset_type: 'scene', asset_id: 'scene-1', name: 'Night train', source_scope: 'episode', source_container_id: 'project', selected_variant_id: 'scene-v1', variants: [{ id: 'scene-v1', url: 'scene.png' }] },
   { asset_type: 'prop', asset_id: 'prop-1', name: 'Pocket watch', source_scope: 'episode', source_container_id: 'project', selected_variant_id: 'prop-v1', variants: [{ id: 'prop-v1', url: 'watch.png' }] },
  ],
 });
 vi.mocked(api.generateAsset).mockResolvedValue(withLibrary as any);
 show();
 await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add reference images' })[0]).not.toBeDisabled());
 fireEvent.click(screen.getAllByRole('button', { name: 'Add reference images' })[0]);
 fireEvent.click(screen.getByRole('button', { name: 'Toggle this Night train variant in the available reference pool' }));
 fireEvent.click(screen.getByRole('button', { name: 'Toggle this Pocket watch variant in the available reference pool' }));

 setPromptDocument('<p>@</p>');
 expect(screen.getByRole('listbox', { name: 'Reference index' })).toHaveTextContent('Night train');
 fireEvent.click(screen.getByRole('option', { name: /Night train/ }));
 act(() => { promptEditor().editor.commands.insertContent('@'); });
 fireEvent.click(screen.getByRole('option', { name: /Pocket watch/ }));
 fireEvent.click(screen.getByRole('button', { name: 'Reference image' }));
 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 const args = vi.mocked(api.generateAsset).mock.calls[0];
 expect(args[13]).toEqual([
  { asset_type: 'scene', asset_id: 'scene-1', variant_id: 'scene-v1' },
  { asset_type: 'prop', asset_id: 'prop-1', variant_id: 'prop-v1' },
 ]);
 expect(args[14]).toBe('reference');
 expect(JSON.stringify(args)).not.toContain('scene.png');
});
it('selects a canonical output without silently using it as generation input', async () => {
 const withVariants = { ...project, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }, { id: 'two', url: 'two.png' }], selected_image_id: 'two' } }] };
 useProjectStore.setState({ currentProject: withVariants, projects: [withVariants] });
 vi.mocked(api.selectAssetVariant).mockResolvedValue({ ...withVariants, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }, { id: 'two', url: 'two.png' }], selected_image_id: 'one' } }] } as any);
 vi.mocked(api.generateAsset).mockResolvedValue(withVariants as any);
 show(); fireEvent.click(screen.getByText('Test one'));
 await waitFor(() => expect(api.selectAssetVariant).toHaveBeenCalledWith('project', 'char', 'character', 'one', 'reference_sheet'));
 expect(screen.getByLabelText('Available reference candidates')).toHaveTextContent('Test');
 fireEvent.click(screen.getByRole('button', { name: /Generate .*more/ }));
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 expect(vi.mocked(api.generateAsset).mock.calls[0][12]).toBeUndefined();
 expect(vi.mocked(api.generateAsset).mock.calls[0][13]).toEqual([]);
 expect(vi.mocked(api.generateAsset).mock.calls[0][14]).toBe('text');
});
it('updates the selected output before a slow response and preserves the latest click', async () => {
 const withVariants = { ...project, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'uploaded', url: 'uploaded.png' }, { id: 'generated', url: 'generated.png' }], selected_image_id: 'uploaded' }, image_url: 'uploaded.png' }] };
 useProjectStore.setState({ currentProject: withVariants, projects: [withVariants] });
 let finishFirst!: (value: any) => void;
 vi.mocked(api.selectAssetVariant)
  .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
  .mockResolvedValueOnce({ ...withVariants, characters: [{ ...withVariants.characters[0], reference_sheet: { ...withVariants.characters[0].reference_sheet, selected_image_id: 'uploaded' } }] } as any);
 show();
 fireEvent.click(screen.getByText('Test generated'));
 expect(useProjectStore.getState().currentProject?.characters[0].reference_sheet?.selected_image_id).toBe('generated');
 expect(useProjectStore.getState().currentProject?.characters[0].image_url).toBe('generated.png');
 await waitFor(() => expect(api.selectAssetVariant).toHaveBeenCalledTimes(1));
 fireEvent.click(screen.getByText('Test uploaded'));
 expect(useProjectStore.getState().currentProject?.characters[0].reference_sheet?.selected_image_id).toBe('uploaded');
 finishFirst({ ...withVariants, characters: [{ ...withVariants.characters[0], reference_sheet: { ...withVariants.characters[0].reference_sheet, selected_image_id: 'generated' } }] });
 await waitFor(() => expect(api.selectAssetVariant).toHaveBeenCalledTimes(2));
 await waitFor(() => expect(useProjectStore.getState().currentProject?.characters[0].reference_sheet?.selected_image_id).toBe('uploaded'));
});
it('allows retrying the same file after upload fails', async () => {
 vi.mocked(api.uploadAsset).mockRejectedValue(new Error('Upload unavailable'));
 show(); fireEvent.click(screen.getByRole('button', { name: 'Reference image' }));
 const input = screen.getByLabelText('Upload reference image');
 const file = new File(['image'], 'reference.png', { type: 'image/png' });
 fireEvent.change(input, { target: { files: [file] } });
 await waitFor(() => expect((screen.getByRole('button', { name: 'Upload reference image' }) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.change(input, { target: { files: [file] } });
 await waitFor(() => expect(api.uploadAsset).toHaveBeenCalledTimes(2));
 expect(useProjectStore.getState().currentProject?.characters).toEqual([character]);
});
it('confirms and deletes a canonical reference revision', async () => {
 const withVariants = { ...project, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }, { id: 'two', url: 'two.png' }], selected_image_id: 'two' } }] };
 useProjectStore.setState({ currentProject: withVariants, projects: [withVariants] });
 vi.spyOn(window, 'confirm').mockReturnValue(true);
 vi.mocked(api.deleteAssetVariant).mockResolvedValue({ ...project, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }], selected_image_id: 'one' } }] });
 show();
 const deleteButtons = screen.getAllByRole('button', { name: 'Delete reference image' });
 fireEvent.click(deleteButtons[1]);
 await waitFor(() => expect(api.deleteAssetVariant).toHaveBeenCalledWith('project', 'char', 'character', 'two'));
 await waitFor(() => expect(screen.queryByText('Test two')).toBeNull());
});
it('labels a child reference by angle and framing without creating another asset', async () => {
 const withVariants = { ...project, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }, { id: 'two', url: 'two.png' }], selected_image_id: 'one' } }] };
 useProjectStore.setState({ currentProject: withVariants, projects: [withVariants] });
 vi.mocked(api.updateAssetVariantMetadata).mockResolvedValue(withVariants);
 show();
 fireEvent.change(screen.getAllByRole('combobox', { name: 'View angle for Test' })[0], { target: { value: 'front' } });
 await waitFor(() => expect(api.updateAssetVariantMetadata).toHaveBeenCalledWith('project', 'char', 'character', 'one', 'front', undefined));
});

it('keeps provider prompts out of the default customer view', async () => {
 const stylePrompt = 'premium Chinese e-commerce product advertisement, controlled highlights';
 const styledProject = {
  ...project,
  art_direction: {
   style_config: {
    id: 'ecommerce_product_ad',
    name: 'E-commerce Product Advertisement',
    positive_prompt: stylePrompt,
    negative_prompt: 'cartoon, anime',
   },
  },
 };
 useProjectStore.setState({ currentProject: styledProject, projects: [styledProject] });
 vi.mocked(api.getStylePresets).mockResolvedValue([{ id: 'ecommerce_product_ad', name: 'E-commerce Product Advertisement', name_zh: '电商产品广告', subtitle_zh: '产品主视觉' }] as any);
 show();

 const promptEditor = screen.getByRole('textbox');
 expect(promptEditor).toHaveTextContent('构图：');
 expect(promptEditor).not.toHaveTextContent('Composition:');
 expect(screen.queryByText(stylePrompt)).toBeNull();
 expect(screen.getByTestId('cast-generation-summary')).toHaveTextContent('E-commerce Product Advertisement');

 fireEvent.click(screen.getByRole('button', { name: 'Advanced: view model prompts' }));
 expect(screen.getByText(stylePrompt)).toBeTruthy();
});

it('attaches a specific asset-library variant and submits only stable ids', async () => {
 const libraryAsset = {
  id: 'library-scene',
  name: 'Tea room',
  description: 'Wooden tea table',
  source: 'global',
  image_asset: { variants: [{ id: 'scene-variant', url: 'users/owner/scene.png' }], selected_id: 'scene-variant' },
 };
 const withLibrary = { ...project, scenes: [libraryAsset] };
 useProjectStore.setState({ currentProject: withLibrary, projects: [withLibrary] });
 vi.mocked(api.getAssetReferenceIndex).mockResolvedValue({
  schema_version: 1,
  project_id: 'project',
  assets: [{ asset_type: 'scene', asset_id: 'library-scene', name: 'Tea room', source_scope: 'global', source_container_id: null, selected_variant_id: 'scene-variant', variants: libraryAsset.image_asset.variants }],
 });
 vi.mocked(api.getProject).mockResolvedValue(withLibrary as any);
 vi.mocked(api.generateAsset).mockResolvedValue(withLibrary as any);
 show();

 await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add reference images' })[0]).not.toBeDisabled());
 fireEvent.click(screen.getAllByRole('button', { name: 'Add reference images' })[0]);
 fireEvent.click(screen.getByRole('button', { name: 'Toggle this Tea room variant in the available reference pool' }));
 setPromptDocument('<p>@Tea room</p>');
 fireEvent.click(screen.getByRole('option', { name: /Tea room/ }));
 fireEvent.click(screen.getByRole('button', { name: 'Reference image' }));

 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 const args = vi.mocked(api.generateAsset).mock.calls[0];
 expect(args[12]).toBeUndefined();
 expect(args[13]).toEqual([{ asset_type: 'scene', asset_id: 'library-scene', variant_id: 'scene-variant' }]);
 expect(args[14]).toBe('reference');
 expect(args[6]).toContain('@Tea room');
 expect(JSON.stringify(args)).not.toContain('users/owner/scene.png');
});

it('does not submit a reference whose variant disappeared from the fresh index', async () => {
 const libraryAsset = {
  id: 'library-scene', name: 'Tea room', description: 'Quiet room',
  image_asset: { variants: [{ id: 'deleted-variant', url: 'users/owner/scene.png' }], selected_id: 'deleted-variant' },
 };
 const withLibrary = { ...project, scenes: [libraryAsset] };
 useProjectStore.setState({ currentProject: withLibrary, projects: [withLibrary] });
 vi.mocked(api.getAssetReferenceIndex)
  .mockResolvedValueOnce({ schema_version: 1, project_id: 'project', assets: [{ asset_type: 'scene', asset_id: libraryAsset.id, name: libraryAsset.name, source_scope: 'global', source_container_id: null, selected_variant_id: 'deleted-variant', variants: libraryAsset.image_asset.variants }] } as any)
  .mockResolvedValueOnce({ schema_version: 1, project_id: 'project', assets: [] } as any);
 vi.mocked(api.getProject).mockResolvedValue(withLibrary as any);
 show();
 await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add reference images' })[0]).not.toBeDisabled());
 fireEvent.click(screen.getAllByRole('button', { name: 'Add reference images' })[0]);
 fireEvent.click(screen.getByRole('button', { name: 'Toggle this Tea room variant in the available reference pool' }));
 setPromptDocument('<p>@Tea room</p>');
 fireEvent.click(screen.getByRole('option', { name: /Tea room/ }));
 fireEvent.click(screen.getByRole('button', { name: 'Reference image' }));
 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await waitFor(() => expect(api.getAssetReferenceIndex).toHaveBeenCalledTimes(2));
 expect(api.generateAsset).not.toHaveBeenCalled();
});

it('removes an explicit reference image before the next text-to-image request', async () => {
 const libraryAsset = {
  id: 'library-prop',
  name: 'Tea cup',
  description: 'Ceramic cup',
  source: 'global',
  image_asset: { variants: [{ id: 'prop-variant', url: 'users/owner/prop.png' }], selected_id: 'prop-variant' },
 };
 const withLibrary = { ...project, props: [libraryAsset] };
 useProjectStore.setState({ currentProject: withLibrary, projects: [withLibrary] });
 vi.mocked(api.getAssetReferenceIndex).mockResolvedValue({
  schema_version: 1,
  project_id: 'project',
  assets: [{ asset_type: 'prop', asset_id: 'library-prop', name: 'Tea cup', source_scope: 'global', source_container_id: null, selected_variant_id: 'prop-variant', variants: libraryAsset.image_asset.variants }],
 });
 vi.mocked(api.getProject).mockResolvedValue(withLibrary as any);
 vi.mocked(api.generateAsset).mockResolvedValue(withLibrary as any);
 show();

 await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add reference images' })[0]).not.toBeDisabled());
 fireEvent.click(screen.getAllByRole('button', { name: 'Add reference images' })[0]);
 fireEvent.click(screen.getByRole('button', { name: 'Toggle this Tea cup variant in the available reference pool' }));
 fireEvent.click(screen.getByRole('button', { name: 'Remove Tea cup from available references' }));
 fireEvent.click(screen.getByRole('button', { name: 'Text to image' }));
 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 const args = vi.mocked(api.generateAsset).mock.calls[0];
 expect(args[12]).toBeUndefined();
 expect(args[13]).toEqual([]);
 expect(args[14]).toBe('text');
 expect(args[6]).not.toContain('@');
});

it('loads a global library reference from the server asset index', async () => {
 const localScene = { id: 'scene', name: 'Current scene', description: 'Current' };
 const libraryScene = {
  id: 'global-scene',
  name: 'Shared tea room',
  description: 'Wooden tea table',
  image_asset: { variants: [{ id: 'global-variant', url: 'users/owner/scene.png' }], selected_id: 'global-variant' },
 };
 const localProject = { ...project, scenes: [localScene] };
 useProjectStore.setState({ currentProject: localProject, projects: [localProject] });
 vi.mocked(api.getProject).mockResolvedValue(localProject as any);
 vi.mocked(api.getAssetReferenceIndex).mockResolvedValue({
  schema_version: 1,
  project_id: 'project',
  assets: [{ asset_type: 'scene', asset_id: 'global-scene', name: 'Shared tea room', source_scope: 'global', source_container_id: null, selected_variant_id: 'global-variant', variants: libraryScene.image_asset.variants }],
 });
 vi.mocked(api.generateAsset).mockResolvedValue(localProject as any);
 show();

 await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add reference images' })[0]).not.toBeDisabled());
 fireEvent.click(screen.getAllByRole('button', { name: 'Add reference images' })[0]);
 const referenceButton = await screen.findByRole('button', { name: 'Toggle this Shared tea room variant in the available reference pool' });
 fireEvent.click(referenceButton);
 expect(screen.getByLabelText('Available reference candidates')).toHaveTextContent('Shared tea room');
 expect(api.listLibraryAssets).not.toHaveBeenCalled();
});
