import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import AgentComposer from './AgentComposer';
import { usePlaygroundStore } from './usePlaygroundStore';
import { installUniArtCatalog } from './playgroundModels';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ API_URL: 'https://garage.uniart.fun' }));
vi.mock('./ModelSelector', () => ({ default: () => null }));
vi.mock('./MediaInput', () => ({ default: () => <div>Media selection panel</div> }));
vi.mock('./PromptTemplateModal', () => ({ default: () => null }));
vi.mock('./PromptHistoryDrawer', () => ({ default: () => null }));

beforeEach(() => {
    installUniArtCatalog([{ id: 'uniart/gpt-image-2', api_model_id: 'gpt-image-2', display_name: 'GPT Image', description: '', family: 'gpt-image', provider: 'uniart', capabilities: ['t2i', 'i2i'], duration: null, params: { size: { options: ['1k', '2k', '4k'], default: '1k' } }, inputs: {} }]);
    usePlaygroundStore.setState({ mode: 'i2i', modelId: 'uniart/gpt-image-2', parameters: {}, inputMedia: ['picture.png'], history: [], mediaNames: {}, prompt: 'hello', negativePrompt: '' });
});

it('keeps one add button and separates creation methods from media selection', () => {
    render(<AgentComposer canGenerate batchSize={1} onGenerate={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: '添加参考素材' })).toHaveLength(1);
    expect(within(screen.getByLabelText('参考素材列表')).getByRole('button', { name: '添加参考素材' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('参考素材列表')).getByRole('img')).toBeInTheDocument();
    expect(screen.getByLabelText('字数统计')).toHaveTextContent('5 / 2000');
    fireEvent.click(screen.getByRole('button', { name: 'mode.i2i' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'mode.t2i' })).toBeInTheDocument();
    expect(screen.queryByText('Media selection panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '添加参考素材' }));
    expect(screen.getByText('Media selection panel')).toBeInTheDocument();
});

it('persists image ratio and quality selection in submission parameters', () => {
    render(<AgentComposer canGenerate batchSize={1} onGenerate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '1:1' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '16:9' }));
    expect(usePlaygroundStore.getState().parameters.aspect_ratio).toBe('16:9');
    fireEvent.click(screen.getByRole('button', { name: 'high' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'medium' }));
    expect(usePlaygroundStore.getState().parameters).toEqual({ aspect_ratio: '16:9', quality: 'medium' });
});

it('uses the existing type popup and composer for Agent while keeping shared actions', () => {
    const change = vi.fn();
    const send = vi.fn();
    render(<AgentComposer canGenerate batchSize={4} onGenerate={send} onAgentChange={change}
        agent={{ active: true, model: 'chat-real', models: [{ api_model_id: 'chat-real', display_name: 'GPT 6' }], setModel: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Agent' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'mode.outputImage' }));
    expect(change).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('button', { name: '×4' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'mode.i2i' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sessions.templates' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sessions.allHistory' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(send).toHaveBeenCalledOnce();
});

it('switches video resolution to image tiers without submitting stale video parameters', () => {
    usePlaygroundStore.setState({ mode: 't2v', modelId: 'video-model', modelPreferences: {}, parameters: { resolution: '720p', duration: 5, audio: true }, prompt: 'keep me' });
    render(<AgentComposer canGenerate batchSize={1} onGenerate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'mode.outputVideo' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'mode.outputImage' }));
    expect(usePlaygroundStore.getState().parameters).toEqual({});
    expect(usePlaygroundStore.getState().prompt).toBe('keep me');
    fireEvent.click(screen.getByRole('button', { name: '1k' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '2k' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '720p' })).not.toBeInTheDocument();
});
