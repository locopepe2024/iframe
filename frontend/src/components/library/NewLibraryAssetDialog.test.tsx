import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import NewLibraryAssetDialog from './NewLibraryAssetDialog';
import { api } from '@/lib/api';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({
  API_URL: 'https://garage.uniart.fun',
  api: {
    createLibraryAsset: vi.fn().mockResolvedValue({ id: 'asset' }),
    uploadLibraryImage: vi.fn(),
    getPlatformPublisher: vi.fn().mockResolvedValue({ profile_id: 'apikey-test', authorized: false }),
    getPlatformReferenceCategories: vi.fn().mockResolvedValue({ categories: [{ id: 'character/reference', label: '角色参考' }, { id: 'character/identity/face', label: '面容' }], suggested_tags: ['角色设定稿', '转面三视图'] }),
    submitPlatformCandidate: vi.fn().mockResolvedValue({ platform_resource_id: 'candidate-1' }),
  },
}));
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it('registers a workbench image as the initial variant of a typed asset', async () => {
  render(
    <NewLibraryAssetDialog
      initialImageUrl="output/playground/images/result.png"
      initialImageOrigin="workbench"
      initialSourceGenerationId="generation-1"
      initialSourceOutputId="output-1"
      initialDescription="正面全身角色设定图，冷灰蓝色调"
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />,
  );
  expect(screen.getByRole('dialog', { name: '录入生成结果' })).toHaveTextContent('保存到当前账户的跨项目资产库');
  fireEvent.change(screen.getByLabelText('nameLabel'), { target: { value: '女主播' } });
  expect(screen.getByLabelText('descLabel')).toHaveValue('正面全身角色设定图，冷灰蓝色调');
  fireEvent.submit(screen.getByRole('button', { name: 'create' }).closest('form')!);

  await waitFor(() => expect(api.createLibraryAsset).toHaveBeenCalledWith('character', {
    name: '女主播',
    description: '正面全身角色设定图，冷灰蓝色调',
    image_url: 'output/playground/images/result.png',
    image_origin: 'workbench',
    source_generation_id: 'generation-1',
    source_output_id: 'output-1',
  }));
});

it('imports multiple reference images as one structured asset', async () => {
  vi.mocked(api.uploadLibraryImage)
    .mockResolvedValueOnce({ image_url: 'output/hero-front.png' })
    .mockResolvedValueOnce({ image_url: 'output/hero-profile.png' });
  const { container } = render(<NewLibraryAssetDialog onClose={vi.fn()} onCreated={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('nameLabel'), { target: { value: 'Hero' } });
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(['front'], 'front.png', { type: 'image/png' }), new File(['profile'], 'profile.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(screen.getByText('已导入 2 张参考图')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('第 2 张参考职责'), { target: { value: 'profile' } });
  fireEvent.submit(screen.getByRole('button', { name: 'create' }).closest('form')!);
  await waitFor(() => expect(api.createLibraryAsset).toHaveBeenCalledWith('character', expect.objectContaining({
    name: 'Hero',
    initial_variants: [
      expect.objectContaining({ image_url: 'output/hero-front.png', reference_view_role: 'front' }),
      expect.objectContaining({ image_url: 'output/hero-profile.png', reference_view_role: 'profile' }),
    ],
  })));
});

it('submits an authorized image with the reviewed description and stable output identity', async () => {
  vi.mocked(api.getPlatformPublisher).mockResolvedValueOnce({ profile_id: 'apikey-test', authorized: true });
  render(<NewLibraryAssetDialog initialImageUrl="output/result.png" initialImageOrigin="workbench"
    initialSourceGenerationId="generation-1" initialSourceOutputId="output-1"
    initialDescription="原始模型提示词" onClose={vi.fn()} onCreated={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('option', { name: '平台参考库 · 提交审核' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('录入目标'), { target: { value: 'platform' } });
  expect(screen.getByRole('dialog', { name: '录入生成结果' })).toHaveTextContent('提交平台参考库审核；审核发布后所有用户可检索。');
  fireEvent.change(screen.getByLabelText('平台类别'), { target: { value: 'character/identity/face' } });
  fireEvent.change(screen.getByLabelText('nameLabel'), { target: { value: '面部基准' } });
  fireEvent.change(screen.getByLabelText('配套 Prompt（可编辑）'), { target: { value: '编辑后的可复用描述' } });
  fireEvent.click(screen.getByRole('button', { name: '角色设定稿' }));
  fireEvent.change(screen.getByLabelText('角色标签'), { target: { value: '角色设定稿，转面三视图' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '我确认拥有将此内容提交平台审核的权利' }));
  fireEvent.click(screen.getByRole('button', { name: '提交平台审核' }));
  await waitFor(() => expect(api.submitPlatformCandidate).toHaveBeenCalledWith({
    source_generation_id: 'generation-1', source_output_id: 'output-1', kind: 'image',
    category_path: 'character/identity/face', tags: ['角色设定稿', '转面三视图'], title: '面部基准',
    description: '编辑后的可复用描述', rights_confirmed: true,
  }));
  expect(api.createLibraryAsset).not.toHaveBeenCalled();
});

it('does not allow an unapproved account to submit a platform candidate', async () => {
  render(<NewLibraryAssetDialog initialImageUrl="output/result.png" initialSourceGenerationId="generation-1"
    initialSourceOutputId="output-1" onClose={vi.fn()} onCreated={vi.fn()} />);
  await waitFor(() => expect(screen.getByText(/当前账户无平台录入权限/)).toBeInTheDocument());
  expect(screen.getByRole('option', { name: '平台参考库 · 提交审核' })).toBeDisabled();
  expect(api.submitPlatformCandidate).not.toHaveBeenCalled();
});

it('submits a video candidate only after choosing a category and confirming rights', async () => {
  vi.mocked(api.getPlatformPublisher).mockResolvedValueOnce({ profile_id: 'apikey-test', authorized: true });
  render(<NewLibraryAssetDialog initialImageUrl="/playground/media/g/v?signature=test" initialMediaType="video"
    initialSourceGenerationId="g" initialSourceOutputId="v" initialDescription="视频生成提示词"
    onClose={vi.fn()} onCreated={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('option', { name: '角色参考 · character/reference' })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('nameLabel'), { target: { value: '运镜样片' } });
  expect(screen.getByRole('button', { name: '提交平台审核' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '我确认拥有将此内容提交平台审核的权利' }));
  fireEvent.click(screen.getByRole('button', { name: '提交平台审核' }));
  await waitFor(() => expect(api.submitPlatformCandidate).toHaveBeenCalledWith(expect.objectContaining({
    source_generation_id: 'g', source_output_id: 'v', kind: 'video',
    category_path: 'character/reference', tags: [], description: '视频生成提示词',
  })));
});
