// @vitest-environment jsdom
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/en.json';
import CastWorkbenchModal, { activePolls, startAssetPoll } from '@/components/modules/cast/CastWorkbenchModal';
import { useProjectStore } from '@/store/projectStore';
import { useToastStore } from '@/store/toastStore';
import { agentRequest, api } from '@/lib/api';
Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{ top: 0, bottom: 1, left: 0, right: 1 }] });
Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 1, left: 0, right: 1 }) });
vi.mock('@/lib/api', () => ({ API_URL: '', agentRequest: vi.fn().mockResolvedValue({ installed: [] }), api: { getStylePresets: vi.fn().mockResolvedValue([]), getProject: vi.fn(), getTaskStatus: vi.fn(), getAssetReferenceIndex: vi.fn(), getEpisodeVisualContext: vi.fn(), listLibraryAssets: vi.fn(), generateAsset: vi.fn(), previewAssetImageSubmission: vi.fn(), uploadAsset: vi.fn(), selectAssetVariant: vi.fn(), deleteAssetVariant: vi.fn(), updateAssetVariantMetadata: vi.fn(), updateAssetAttributes: vi.fn() } }));
vi.mock('@/components/common/GroupedModelGrid', () => ({ default: () => null }));
vi.mock('@/components/shared/preview/PreviewImage', () => ({ default: ({ alt, clickToLightbox }: any) => <span onClick={clickToLightbox ? e => e.stopPropagation() : undefined}>{alt}</span> }));
vi.mock('@/components/shared/AssetIndexPreview', () => ({ AssetIndexPreview: ({ alt }: { alt?: string }) => <span data-testid="asset-preview">{alt}</span> }));
const character = { id: 'char', name: 'Test', description: 'Person' };
const project: any = { id: 'project', title: 'Project', characters: [character], scenes: [], props: [] };
function show() { render(<NextIntlClientProvider locale="en" messages={messages}><CastWorkbenchModal isOpen kind="character" entityId="char" onClose={() => {}} /></NextIntlClientProvider>); }
function showScene(scene: any) {
 const sceneProject = { ...project, scenes: [scene] };
 useProjectStore.setState({ currentProject: sceneProject, projects: [sceneProject] });
 return render(<NextIntlClientProvider locale="en" messages={messages}><CastWorkbenchModal isOpen kind="scene" entityId={scene.id} onClose={() => {}} /></NextIntlClientProvider>);
}
function promptEditor() {
 return document.querySelector('[contenteditable="true"]') as HTMLElement & { editor: import('@tiptap/core').Editor };
}
function setPromptDocument(html: string) {
 act(() => { promptEditor().editor.commands.focus(); promptEditor().editor.commands.setContent(html); });
}
async function approveImageReview() {
 const confirm = await screen.findByRole('button', { name: '确认并生成' });
 await waitFor(() => expect(confirm).not.toBeDisabled());
 fireEvent.click(confirm);
}
beforeEach(() => {
 cleanup();
 for (const poll of Array.from(activePolls.values())) clearInterval(poll);
 activePolls.clear();
 vi.useRealTimers();
 vi.clearAllMocks();
 useToastStore.getState().clear();
 vi.mocked(api.getAssetReferenceIndex).mockResolvedValue({ schema_version: 1, project_id: 'project', assets: [] });
 vi.mocked(api.getEpisodeVisualContext).mockResolvedValue({ context: null, bindings: [] });
 vi.mocked(api.previewAssetImageSubmission).mockImplementation(async (_id, request) => ({
  positive_prompt: request.prompt, negative_prompt: request.negative_prompt,
  selected_model_id: 'test-model', aspect_ratio: '9:16',
  generation_type: request.generation_type, image_generation_mode: request.image_generation_mode,
  batch_size: request.batch_size, reference_inputs: request.references || [],
  design_revision_at_submission: null, fingerprint: 'reviewed',
 }));
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
  getProject: (projectId: string) => projectId === project.id ? project : undefined,
 }));

 await act(async () => { await vi.advanceTimersByTimeAsync(2500); });

 expect(useProjectStore.getState().currentProject?.characters).toEqual([completedAsset]);
 expect(useProjectStore.getState().generatingTasks).toEqual([]);
 expect(api.getProject).not.toHaveBeenCalled();
 expect(activePolls.has('char')).toBe(false);
 vi.useRealTimers();
});
it('surfaces one dismissible terminal failure when status requests overlap', async () => {
 vi.useFakeTimers();
 let resolveStatus!: (status: any) => void;
 const pendingStatus = new Promise<any>((resolve) => { resolveStatus = resolve; });
 vi.mocked(api.getTaskStatus).mockReturnValue(pendingStatus);
 const removeGeneratingTask = vi.fn();
 startAssetPoll('char', 'task', 'project', 'character', 'reference_sheet', ((key: string) => key) as any, () => ({
  updateProject: vi.fn(),
  removeGeneratingTask,
  getProject: () => project,
 }));

 await act(async () => { await vi.advanceTimersByTimeAsync(7500); });
 expect(api.getTaskStatus).toHaveBeenCalledTimes(1);

 await act(async () => {
  resolveStatus({ status: 'failed', error: '生成失败：UniArt task failed: content safety policy' });
  await Promise.resolve();
 });

 expect(useToastStore.getState().toasts).toHaveLength(1);
 expect(useToastStore.getState().toasts[0]).toMatchObject({
  title: 'toastGenErr',
  body: 'UniArt task failed: content safety policy',
 });
 expect(removeGeneratingTask).toHaveBeenCalledTimes(1);
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
 await approveImageReview();
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 expect(vi.mocked(api.generateAsset).mock.calls[0][12]).toBeUndefined();
 expect(vi.mocked(api.generateAsset).mock.calls[0][13]).toEqual([]);
 expect(vi.mocked(api.generateAsset).mock.calls[0][14]).toBe('text');
 expect(vi.mocked(api.generateAsset).mock.calls[0][6]).not.toContain('@');
});

it('submits only once when generate is clicked twice during project validation', async () => {
 let finishValidation!: (value: any) => void;
 vi.mocked(api.getProject).mockReturnValue(new Promise((resolve) => { finishValidation = resolve; }) as any);
 vi.mocked(api.generateAsset).mockResolvedValue(project as any);
 show();

 const button = await screen.findByRole('button', { name: /Generate first batch/ });
 fireEvent.click(button);
 fireEvent.click(button);
 await approveImageReview();

 expect(api.getProject).toHaveBeenCalledTimes(1);
 await act(async () => finishValidation(project));
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalledTimes(1));
 expect(vi.mocked(api.generateAsset).mock.calls[0][9]).toBe(1);
});

it('does not load the legacy character Skill facet panel', () => {
 show();
 expect(agentRequest).not.toHaveBeenCalled();
 expect(screen.queryByText('Eyes and gaze')).not.toBeInTheDocument();
});

it('separates scene content from continuity and submits only reviewed text', async () => {
 const scene = { id: 'scene-1', name: '粮铺门前', description: '长街中段的粮铺' };
 vi.mocked(api.getEpisodeVisualContext).mockResolvedValue({ context: {
  scenes: [{ scene_id: 'plan-1', scene_asset_id: scene.id, scene_ref: '青溪镇长街·粮铺劫掠',
   location: '青溪镇长街', time_anchor: '暮秋，残阳如血', atmosphere: '人流繁杂',
   continuity_in: '匪寇围堵粮铺', place_continuity_id: 'longstreet', time_continuity_id: 'dusk' }],
  lighting_baselines: [{ place_continuity_id: 'longstreet', time_continuity_id: 'dusk',
   lighting: { key_source: '低位斜阳', color_tone: '暖褐与血红夕照', contrast: '中高反差', practical_sources: [] },
   story_time: '黄昏', daylight_phase: '', weather: '', shadow_direction: '' }],
  shots: [], characters: [], props: [],
 }, bindings: [] } as any);
 vi.mocked(api.getProject).mockResolvedValue({ ...project, scenes: [scene] } as any);
 vi.mocked(api.generateAsset).mockResolvedValue({ ...project, scenes: [scene] } as any);
 showScene(scene);
 expect(document.querySelector('[contenteditable="true"]')?.textContent).not.toContain('不出现人物');
 expect(await screen.findByRole('region', { name: '场景画面描述' })).toHaveTextContent('匪寇围堵粮铺');
 expect(screen.getByRole('region', { name: '场景画面描述' })).not.toHaveTextContent('暖褐与血红夕照');
 expect(screen.getByRole('region', { name: '连续性参考' })).toHaveTextContent('暖褐与血红夕照');
 expect(screen.getByRole('region', { name: '连续性参考' })).not.toHaveTextContent('匪寇围堵粮铺');
 expect(document.querySelector('[contenteditable="true"]')).not.toHaveTextContent('暖褐与血红夕照');
 fireEvent.click(within(screen.getByRole('region', { name: '场景画面描述' })).getAllByRole('button', { name: '加入此项' })[2]);
 fireEvent.change(screen.getByRole('textbox', { name: '排除词（单独提交给模型）' }), { target: { value: '不要偏红' } });
 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await approveImageReview();
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 const args = vi.mocked(api.generateAsset).mock.calls[0];
 expect(args[6]).not.toContain('暖褐与血红夕照');
 expect(args[6]).toContain('匪寇围堵粮铺');
 expect(args[8]).toBe('不要偏红');
 expect(args[15]).toBe(true);
 expect(args[16]).toBe('reviewed');
});

it('lets scene designers ask AI for an editable draft and save it without replacing the asset description', async () => {
 const scene = { id: 'scene-1', name: '粮铺门前', description: '青溪镇街边粮铺' };
 vi.mocked(agentRequest).mockResolvedValueOnce({
  visual_notes: '青石板长街，灰青木构粮铺，暮秋残阳从右后方斜照。', unresolved: [],
 } as any);
 vi.mocked(api.generateAsset).mockResolvedValue({ ...project, scenes: [scene] } as any);
 vi.mocked(api.updateAssetAttributes).mockResolvedValue({ ...project, scenes: [{
  ...scene, asset_design: { visual_notes: '用户调整后的粮铺外观', confirmed: true },
 }] } as any);
 showScene(scene);

 fireEvent.change(screen.getByLabelText('设计要求'), { target: { value: '南北要道，暮秋黄昏，画面简洁' } });
 fireEvent.click(screen.getByRole('button', { name: '生成设计草稿' }));
 await waitFor(() => expect(agentRequest).toHaveBeenCalledWith('/asset-design/draft', 'POST', expect.objectContaining({
  asset_type: 'scene', asset_name: '粮铺门前', user_requirements: '南北要道，暮秋黄昏，画面简洁',
 })));
 expect((screen.getByLabelText('视觉设计草稿') as HTMLTextAreaElement).value).toContain('青石板长街');
 expect(document.querySelector('[contenteditable="true"]')?.textContent).not.toContain('不出现人物');

 fireEvent.change(screen.getByLabelText('视觉设计草稿'), { target: { value: '用户调整后的粮铺外观' } });
 fireEvent.click(screen.getByRole('button', { name: '确认设计' }));
 await waitFor(() => expect(api.updateAssetAttributes).toHaveBeenCalledWith('project', 'scene-1', 'scene', {
  asset_design: expect.objectContaining({ visual_notes: '用户调整后的粮铺外观', confirmed: true }),
 }));
});

it('keeps only the remaining selected scene image after an external prompt replacement', async () => {
 const scene = { id: 'scene-2', name: '粮铺门前', description: '长街中段' };
 const current = { ...project, scenes: [scene] };
 useProjectStore.setState({ currentProject: current, projects: [current] });
 vi.mocked(api.getProject).mockResolvedValue(current as any);
 vi.mocked(api.generateAsset).mockResolvedValue(current as any);
 vi.mocked(api.getAssetReferenceIndex).mockResolvedValue({ schema_version: 1, project_id: 'project', assets: [
  { asset_type: 'scene', asset_id: 'long-street', name: '青溪镇青石板长街', source_scope: 'episode', source_container_id: 'project', selected_variant_id: 'street-v1', variants: [{ id: 'street-v1', url: 'street.png' }] },
  { asset_type: 'prop', asset_id: 'grain', name: '粮食', source_scope: 'episode', source_container_id: 'project', selected_variant_id: 'grain-v1', variants: [{ id: 'grain-v1', url: 'grain.png' }] },
 ] } as any);
 showScene(scene);
 await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add reference images' })[0]).not.toBeDisabled());
 fireEvent.click(screen.getAllByRole('button', { name: 'Add reference images' })[0]);
 fireEvent.click(await screen.findByRole('button', { name: 'Toggle this 青溪镇青石板长街 variant in the available reference pool' }));
 fireEvent.click(screen.getByRole('button', { name: 'Toggle this 粮食 variant in the available reference pool' }));
 act(() => { (screen.getByRole('textbox', { name: 'Generation description (editable template)' }) as any).editor.commands.setContent('<p>@</p>'); });
 fireEvent.click(screen.getByRole('option', { name: /青溪镇青石板长街/ }));
 act(() => { (screen.getByRole('textbox', { name: 'Generation description (editable template)' }) as any).editor.commands.insertContent('@'); });
 fireEvent.click(screen.getByRole('option', { name: /粮食/ }));
 fireEvent.click(screen.getByRole('button', { name: 'Reference image' }));
 expect(screen.getByRole('textbox', { name: 'Generation description (editable template)' })).toHaveTextContent('青溪镇青石');
 // The AI draft path replaces the prompt with plain text while the selected
 // scene remains. The editor must rebuild the stable token and drop grain.
 vi.mocked(agentRequest).mockResolvedValueOnce({ visual_notes: '粮铺人群退避，背景与@青溪镇青石板长街一致。', unresolved: [] } as any);
 fireEvent.change(screen.getByLabelText('设计要求'), { target: { value: '沿用长街背景' } });
 fireEvent.click(screen.getByRole('button', { name: '生成设计草稿' }));
 await waitFor(() => expect((screen.getByRole('textbox', { name: 'Generation description (editable template)' }) as any).editor.getText()).toContain('背景与@青溪镇青石板长街'));
 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await approveImageReview();
 await waitFor(() => expect(api.generateAsset).toHaveBeenCalled());
 expect(vi.mocked(api.generateAsset).mock.calls[0][13]).toEqual([
  { asset_type: 'scene', asset_id: 'long-street', variant_id: 'street-v1' },
 ]);
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
 fireEvent.click(await screen.findByRole('button', { name: 'Toggle this Night train variant in the available reference pool' }));
 fireEvent.click(screen.getByRole('button', { name: 'Toggle this Pocket watch variant in the available reference pool' }));

 setPromptDocument('<p>@</p>');
 expect(screen.getByRole('listbox', { name: 'Reference index' })).toHaveTextContent('Night train');
 fireEvent.click(screen.getByRole('option', { name: /Night train/ }));
 act(() => { promptEditor().editor.commands.insertContent('@'); });
 fireEvent.click(screen.getByRole('option', { name: /Pocket watch/ }));
 fireEvent.click(screen.getByRole('button', { name: 'Reference image' }));
 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await approveImageReview();
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
 vi.mocked(api.getAssetReferenceIndex).mockResolvedValue({
  schema_version: 1,
  project_id: 'project',
  assets: [{ asset_type: 'character', asset_id: 'char', name: 'Test', source_scope: 'episode', source_container_id: 'project', selected_variant_id: 'two', variants: withVariants.characters[0].reference_sheet.image_variants }],
 });
 vi.mocked(api.selectAssetVariant).mockResolvedValue({ ...withVariants, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }, { id: 'two', url: 'two.png' }], selected_image_id: 'one' } }] } as any);
 vi.mocked(api.generateAsset).mockResolvedValue(withVariants as any);
 show(); fireEvent.click(screen.getByText('Test one'));
 await waitFor(() => expect(api.selectAssetVariant).toHaveBeenCalledWith('project', 'char', 'character', 'one', 'reference_sheet'));
 expect(screen.getByLabelText('Available reference candidates')).toHaveTextContent('Test');
 fireEvent.click(screen.getByRole('button', { name: /Generate .*more/ }));
 await approveImageReview();
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
it('keeps a deleted view out of the gallery and reference picker while the server responds', async () => {
 const withVariants = { ...project, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }, { id: 'two', url: 'two.png' }], selected_image_id: 'two' } }] };
 useProjectStore.setState({ currentProject: withVariants, projects: [withVariants] });
 vi.mocked(api.getAssetReferenceIndex).mockResolvedValue({ schema_version: 1, project_id: 'project', assets: [
  { asset_type: 'character', asset_id: 'char', name: 'Test', source_scope: 'episode', source_container_id: 'project', selected_variant_id: 'two', variants: withVariants.characters[0].reference_sheet.image_variants },
 ] } as any);
 let finish!: (value: any) => void;
 vi.mocked(api.deleteAssetVariant).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
 vi.spyOn(window, 'confirm').mockReturnValue(true);
 show();
 await waitFor(() => expect(api.getAssetReferenceIndex).toHaveBeenCalled());
 fireEvent.click(screen.getAllByRole('button', { name: 'Delete reference image' })[1]);
 expect(screen.queryByText('Test two')).toBeNull();
 fireEvent.click(screen.getAllByRole('button', { name: 'Add reference images' })[0]);
 expect(screen.getByTestId('cast-library-reference-picker')).not.toHaveTextContent('Test two');
 await waitFor(() => expect(api.deleteAssetVariant).toHaveBeenCalled());
 await act(async () => finish({ ...withVariants, characters: [{ ...withVariants.characters[0], reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }], selected_image_id: 'one' } }] }));
 expect(screen.queryByText('Test two')).toBeNull();
});
it('labels a child reference by angle and framing without creating another asset', async () => {
 const withVariants = { ...project, characters: [{ ...character, reference_sheet: { image_variants: [{ id: 'one', url: 'one.png' }, { id: 'two', url: 'two.png' }], selected_image_id: 'one' } }] };
 useProjectStore.setState({ currentProject: withVariants, projects: [withVariants] });
 vi.mocked(api.updateAssetVariantMetadata).mockResolvedValue(withVariants);
 show();
 fireEvent.change(screen.getAllByRole('combobox', { name: 'View angle for Test' })[0], { target: { value: 'front' } });
 await waitFor(() => expect(api.updateAssetVariantMetadata).toHaveBeenCalledWith('project', 'char', 'character', 'one', 'front', undefined));
});

it('keeps project scene style out of an isolated asset prompt', async () => {
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
 expect(screen.getByTestId('cast-generation-summary')).not.toHaveTextContent('E-commerce Product Advertisement');
 expect(screen.queryByRole('button', { name: 'Advanced: view model prompts' })).toBeNull();
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
 fireEvent.click(await screen.findByRole('button', { name: 'Toggle this Tea room variant in the available reference pool' }));
 setPromptDocument('<p>@Tea room</p>');
 fireEvent.click(screen.getByRole('option', { name: /Tea room/ }));
 fireEvent.click(screen.getByRole('button', { name: 'Reference image' }));

 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await approveImageReview();
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
  .mockResolvedValueOnce({ schema_version: 1, project_id: 'project', assets: [{ asset_type: 'scene', asset_id: libraryAsset.id, name: libraryAsset.name, source_scope: 'global', source_container_id: null, selected_variant_id: 'deleted-variant', variants: libraryAsset.image_asset.variants }] } as any)
  .mockResolvedValueOnce({ schema_version: 1, project_id: 'project', assets: [] } as any);
 vi.mocked(api.getProject).mockResolvedValue(withLibrary as any);
 show();
 await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add reference images' })[0]).not.toBeDisabled());
 fireEvent.click(screen.getAllByRole('button', { name: 'Add reference images' })[0]);
 fireEvent.click(await screen.findByRole('button', { name: 'Toggle this Tea room variant in the available reference pool' }));
 setPromptDocument('<p>@Tea room</p>');
 fireEvent.click(screen.getByRole('option', { name: /Tea room/ }));
 fireEvent.click(screen.getByRole('button', { name: 'Reference image' }));
 const checksBeforeSubmission = vi.mocked(api.getAssetReferenceIndex).mock.calls.length;
 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await approveImageReview();
 await waitFor(() => expect(vi.mocked(api.getAssetReferenceIndex).mock.calls.length).toBeGreaterThan(checksBeforeSubmission));
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
 fireEvent.click(await screen.findByRole('button', { name: 'Toggle this Tea cup variant in the available reference pool' }));
 fireEvent.click(screen.getByRole('button', { name: 'Remove Tea cup from available references' }));
 fireEvent.click(screen.getByRole('button', { name: 'Text to image' }));
 fireEvent.click(screen.getByRole('button', { name: /Generate first batch/ }));
 await approveImageReview();
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

it('refreshes indexed variants when project assets change while the picker is open', async () => {
 const indexFor = (variantId: string) => ({
  schema_version: 1,
  project_id: 'project',
  assets: [{
   asset_type: 'character',
   asset_id: 'char',
   name: 'Test',
   source_scope: 'episode',
   variants: [{ id: variantId, url: `${variantId}.png` }],
  }],
 });
 let currentView = 'deleted-view';
 vi.mocked(api.getAssetReferenceIndex).mockImplementation(async () => indexFor(currentView) as any);
 show();

 await waitFor(() => expect(api.getAssetReferenceIndex).toHaveBeenCalledTimes(1));
 fireEvent.click(screen.getAllByRole('button', { name: 'Add reference images' })[0]);
 expect(await screen.findByText('Test deleted-view')).toBeTruthy();

 const updatedProject = {
  ...project,
  characters: [{
   ...character,
   reference_sheet: { selected_image_id: 'new-view', image_variants: [{ id: 'new-view', url: 'new-view.png' }] },
  }],
 };
 const priorRequests = vi.mocked(api.getAssetReferenceIndex).mock.calls.length;
 currentView = 'new-view';
 act(() => useProjectStore.setState({ currentProject: updatedProject, projects: [updatedProject] }));

 await waitFor(() => expect(vi.mocked(api.getAssetReferenceIndex).mock.calls.length).toBeGreaterThan(priorRequests));
 const picker = screen.getByTestId('cast-library-reference-picker');
 await waitFor(() => expect(picker).toHaveTextContent('Test new-view'));
 expect(picker).not.toHaveTextContent('Test deleted-view');
});
