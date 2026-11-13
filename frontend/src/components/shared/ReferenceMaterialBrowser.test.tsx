import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ReferenceMaterialBrowser from './ReferenceMaterialBrowser';
const mocks = vi.hoisted(() => ({ library: vi.fn(), catalog: vi.fn(), resolve: vi.fn(), upload: vi.fn(), history: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { getAssetLibraryIndex: mocks.library, getAssetReferenceIndex: mocks.library, getPlatformReferenceLibrary: mocks.catalog, resolveReferenceMaterial: mocks.resolve }, playgroundApi: { uploadMedia: mocks.upload, getHistory: mocks.history } }));
vi.mock('@/lib/utils', () => ({ getAssetUrl: (path: string) => path }));
vi.mock('./AssetIndexPreview', () => ({ AssetIndexPreview: () => <span /> }));
const title = '模特舞蹈 · 举臂交叉 · 俯视 · 深度参考';
const resource = { platform_resource_id: 'pose.high.depth', revision: 1, title, payload: { remote_url: 'https://example/pose.png', thumbnail_url: 'https://example/pose.webp' } };
beforeEach(() => {
    vi.clearAllMocks(); mocks.library.mockResolvedValue({ assets: [] }); mocks.catalog.mockResolvedValue({ resources: [resource], total: 1 }); mocks.history.mockResolvedValue([]);
    mocks.resolve.mockImplementation((reference, _projectId, label) => Promise.resolve({ reference, label, path: '/studio/owned-media/owner/uploads/pose.png' }));
    mocks.upload.mockResolvedValue({ media_id: 'upload-1', path: '/playground/input-media/pose.png' });
});
it('searches 举臂交叉 and submits its stable revision only after confirmation', async () => {
    const select = vi.fn(); render(<ReferenceMaterialBrowser open onClose={vi.fn()} onSelect={select} />);
    fireEvent.change(screen.getByLabelText('快速搜索参考素材'), { target: { value: '举臂交叉' } });
    fireEvent.click(await screen.findByRole('button', { name: title })); expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '使用参考素材' }));
    await waitFor(() => expect(select).toHaveBeenCalledWith(expect.objectContaining({ reference: { asset_type: 'platform_reference', asset_id: 'pose.high.depth', variant_id: '1', revision: 1, source_scope: 'platform' } }), expect.objectContaining({ label: title })));
    expect(mocks.catalog).toHaveBeenCalledWith('举臂交叉', 'image', undefined, undefined, undefined, undefined, { limit: 36, offset: 0, visual_only: true });
});
it('cancels without resolving or changing a selection', async () => {
    const select = vi.fn(), close = vi.fn(); render(<ReferenceMaterialBrowser open onClose={close} onSelect={select} />);
    fireEvent.click(await screen.findByRole('button', { name: title })); fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(close).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
});
it('keeps project assets usable when the platform fails and supports retry', async () => {
    mocks.catalog.mockRejectedValueOnce(new Error('network unavailable'));
    mocks.library.mockResolvedValue({ assets: [{ name: '项目角色', asset_type: 'character', asset_id: 'hero', source_scope: 'project', source_container_id: 'project', variants: [{ id: 'front', url: '/hero.png' }] }] });
    render(<ReferenceMaterialBrowser open onClose={vi.fn()} onSelect={vi.fn()} projectId="project" />);
    expect(await screen.findByRole('button', { name: '项目角色' })).toBeInTheDocument(); expect(await screen.findByRole('alert')).toHaveTextContent('平台参考库');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' })); expect(await screen.findByRole('button', { name: title })).toBeInTheDocument();
});
it('ignores results from a stale search', async () => {
    let finishOld!: (value: any) => void;
    mocks.catalog.mockImplementation((query: string) => query === '旧' ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ resources: [resource], total: 1 }));
    render(<ReferenceMaterialBrowser open onClose={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('快速搜索参考素材'), { target: { value: '旧' } }); await waitFor(() => expect(finishOld).toBeDefined());
    fireEvent.change(screen.getByLabelText('快速搜索参考素材'), { target: { value: '举臂交叉' } }); expect(await screen.findByRole('button', { name: title })).toBeInTheDocument();
    await act(async () => finishOld({ resources: [{ ...resource, title: '过时结果' }], total: 1 })); expect(screen.queryByRole('button', { name: '过时结果' })).not.toBeInTheDocument();
});
it('uploads an image and verifies the owner registry ID', async () => {
    const select = vi.fn(); render(<ReferenceMaterialBrowser open onClose={vi.fn()} onSelect={select} projectId="project" />);
    fireEvent.click(screen.getByRole('tab', { name: '本地上传' }));
    fireEvent.change(screen.getByLabelText('上传本地参考素材'), { target: { files: [new File(['image'], 'test.png', { type: 'image/png' })] } });
    await screen.findByText('已选择：test.png'); fireEvent.click(screen.getByRole('button', { name: '使用参考素材' }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith({ asset_type: 'media', asset_id: 'upload-1', variant_id: 'upload-1', source_scope: 'private' }, 'project', 'test.png'));
    await waitFor(() => expect(select).toHaveBeenCalledOnce());
});
it('keeps a chosen platform image when project candidates refresh', async () => {
    const select = vi.fn(); const close = vi.fn();
    const view = render(<ReferenceMaterialBrowser open onClose={close} onSelect={select} candidates={[]} />);
    fireEvent.click(await screen.findByRole('button', { name: title }));
    view.rerender(<ReferenceMaterialBrowser open onClose={close} onSelect={select} candidates={[{ label: '更新的角色', reference: { asset_type: 'character', asset_id: 'new', variant_id: 'front' } }]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '使用参考素材' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '使用参考素材' }));
    await waitFor(() => expect(select).toHaveBeenCalledWith(expect.objectContaining({ reference: expect.objectContaining({ asset_id: 'pose.high.depth' }) }), expect.anything()));
});
