// @vitest-environment jsdom
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/en.json';
import CastWorkbenchModal from '@/components/modules/cast/CastWorkbenchModal';
import { useProjectStore } from '@/store/projectStore';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({ API_URL: '', api: { getStylePresets: vi.fn().mockResolvedValue([]), getProject: vi.fn(), listLibraryAssets: vi.fn(), generateAsset: vi.fn(), uploadAsset: vi.fn(), selectAssetVariant: vi.fn(), deleteAssetVariant: vi.fn(), updateAssetVariantMetadata: vi.fn(), favoriteAssetVariant: vi.fn() } }));
vi.mock('@/components/common/GroupedModelGrid', () => ({ default: () => null }));
vi.mock('@/components/shared/preview/PreviewImage', () => ({ default: ({ alt, clickToLightbox }: any) => <span onClick={clickToLightbox ? e => e.stopPropagation() : undefined}>{alt}</span> }));
const character = { id: 'char', name: 'Test', description: 'Person' };
const project: any = { id: 'project', title: 'Project', characters: [character], scenes: [], props: [] };
function show() { render(<NextIntlClientProvider locale="en" messages={messages}><CastWorkbenchModal isOpen kind="character" entityId="char" onClose={() => {}} /></NextIntlClientProvider>); }
beforeEach(() => { cleanup(); vi.clearAllMocks(); useProjectStore.setState({ currentProject: project, projects: [project], currentSeries: null, generatingTasks: [] }); });
it('opens upload from the empty gallery and appends a selected reference', async () => {
 vi.mocked(api.generateAsset).mockResolvedValue(project as any);
 show();
 const input = screen.getByLabelText('Upload reference image');
 const click = vi.spyOn(input, 'click');
 fireEvent.click(screen.getByText(messages.castWorkbench.emptyVariantsTitle));
 expect(click).toHaveBeenCalledOnce();
 const file = new File(['image'], 'reference.png', { type: 'image/png' });
 vi.mocked(api.uploadAsset).mockResolvedValue({ ...project, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }], selected_image_id: 'one' } }] });
 fireEvent.change(input, { target: { files: [file] } });
 await waitFor(() => expect(screen.getByText('Test one')).toBeTruthy());
 expect(api.uploadAsset).toHaveBeenCalledWith('project', 'character', 'char', file, 'reference_sheet');
 fireEvent.click(screen.getByRole('button', { name: /Generate .*more/ }));
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 expect(vi.mocked(api.generateAsset).mock.calls[0][12]).toBeUndefined();
 expect(vi.mocked(api.generateAsset).mock.calls[0][13]).toEqual([{
  mention_id: 'ref_one',
  asset_type: 'character',
  asset_id: 'char',
  variant_id: 'one',
 }]);
 expect(vi.mocked(api.generateAsset).mock.calls[0][6]).toContain('@{ref_one}');
});
it('selects a canonical output without silently using it as generation input', async () => {
 const withVariants = { ...project, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }, { id: 'two', url: 'two.png' }], selected_image_id: 'two' } }] };
 useProjectStore.setState({ currentProject: withVariants, projects: [withVariants] });
 vi.mocked(api.selectAssetVariant).mockResolvedValue({ ...withVariants, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }, { id: 'two', url: 'two.png' }], selected_image_id: 'one' } }] } as any);
 vi.mocked(api.generateAsset).mockResolvedValue(withVariants as any);
 show(); fireEvent.click(screen.getByText('Test one'));
 await waitFor(() => expect(api.selectAssetVariant).toHaveBeenCalledWith('project', 'char', 'character', 'one', 'reference_sheet'));
 fireEvent.click(screen.getByRole('button', { name: /Generate .*more/ }));
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 expect(vi.mocked(api.generateAsset).mock.calls[0][12]).toBeUndefined();
 expect(vi.mocked(api.generateAsset).mock.calls[0][13]).toEqual([]);
});
it('allows retrying the same file after upload fails', async () => {
 vi.mocked(api.uploadAsset).mockRejectedValue(new Error('Upload unavailable'));
 show(); const input = screen.getByLabelText('Upload reference image');
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
 expect((promptEditor as HTMLTextAreaElement).value).toContain('构图：');
 expect((promptEditor as HTMLTextAreaElement).value).not.toContain('Composition:');
 expect(screen.queryByText(stylePrompt)).toBeNull();
 expect(screen.getByTestId('cast-generation-summary')).toHaveTextContent('E-commerce Product Advertisement');

 fireEvent.click(screen.getByRole('button', { name: 'Advanced: view model prompts' }));
 expect(screen.getByText(stylePrompt)).toBeTruthy();
});

it('inserts a specific asset-library variant into the prompt and submits only stable ids', async () => {
 const libraryAsset = {
  id: 'library-scene',
  name: 'Tea room',
  description: 'Wooden tea table',
  source: 'global',
  image_asset: { variants: [{ id: 'scene-variant', url: 'users/owner/scene.png' }], selected_id: 'scene-variant' },
 };
 const withLibrary = { ...project, scenes: [libraryAsset] };
 useProjectStore.setState({ currentProject: withLibrary, projects: [withLibrary] });
 vi.mocked(api.getProject).mockResolvedValue(withLibrary as any);
 vi.mocked(api.generateAsset).mockResolvedValue(withLibrary as any);
 show();

 fireEvent.click(screen.getAllByRole('button', { name: '@ Insert asset' })[0]);
 fireEvent.click(screen.getByRole('button', { name: 'Insert this Tea room variant into the prompt' }));
 expect(screen.getByLabelText('Active asset references')).toHaveTextContent('Tea room');

 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 const args = vi.mocked(api.generateAsset).mock.calls[0];
 expect(args[12]).toBeUndefined();
 expect(args[13]).toEqual([{ mention_id: 'ref_scene-variant', asset_type: 'scene', asset_id: 'library-scene', variant_id: 'scene-variant' }]);
 expect(args[6]).toContain('@{ref_scene-variant}');
 expect(JSON.stringify(args)).not.toContain('users/owner/scene.png');
});

it('removes an explicit asset mention before the next text-to-image request', async () => {
 const libraryAsset = {
  id: 'library-prop',
  name: 'Tea cup',
  description: 'Ceramic cup',
  source: 'global',
  image_asset: { variants: [{ id: 'prop-variant', url: 'users/owner/prop.png' }], selected_id: 'prop-variant' },
 };
 const withLibrary = { ...project, props: [libraryAsset] };
 useProjectStore.setState({ currentProject: withLibrary, projects: [withLibrary] });
 vi.mocked(api.getProject).mockResolvedValue(withLibrary as any);
 vi.mocked(api.generateAsset).mockResolvedValue(withLibrary as any);
 show();

 fireEvent.click(screen.getAllByRole('button', { name: '@ Insert asset' })[0]);
 fireEvent.click(screen.getByRole('button', { name: 'Insert this Tea cup variant into the prompt' }));
 fireEvent.click(screen.getByRole('button', { name: 'Remove Tea cup reference' }));
 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 const args = vi.mocked(api.generateAsset).mock.calls[0];
 expect(args[12]).toBeUndefined();
 expect(args[13]).toEqual([]);
 expect(args[6]).not.toContain('@{');
});

it('loads a global library reference when the project response has only local assets', async () => {
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
 vi.mocked(api.listLibraryAssets).mockResolvedValue({ characters: [], scenes: [libraryScene], props: [] } as any);
 vi.mocked(api.generateAsset).mockResolvedValue(localProject as any);
 show();

 await waitFor(() => expect(screen.getAllByRole('button', { name: '@ Insert asset' })[0]).not.toBeDisabled());
 fireEvent.click(screen.getAllByRole('button', { name: '@ Insert asset' })[0]);
 const referenceButton = await screen.findByRole('button', { name: 'Insert this Shared tea room variant into the prompt' });
 fireEvent.click(referenceButton);
 expect(screen.getByLabelText('Active asset references')).toHaveTextContent('Shared tea room');
});
