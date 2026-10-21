import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import zh from '../../../../messages/zh.json';
import CharacterVoiceBinding from './CharacterVoiceBinding';
import { isUniArtVoiceBinding } from '@/lib/voiceBinding';

const mocks = vi.hoisted(() => ({
  getVoices: vi.fn().mockResolvedValue([
    { id: 'uniart:speech-2.8-hd:male-qn-qingse', name: '清朗男声', gender: 'Male', family: 'minimax', origin: 'system', model: 'speech-2.8-hd' },
    { id: 'uniart:speech-2.8-hd:male-qn-jingying', name: '沉稳男声', gender: 'Male', family: 'minimax', origin: 'system', model: 'speech-2.8-hd' },
  ]),
  listCustomVoices: vi.fn().mockResolvedValue([]),
  previewVoice: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: mocks }));

function setup(save: (attributes: Record<string, unknown>) => Promise<void>, voiceId = 'uniart:speech-2.8-hd:male-qn-qingse') {
  return render(<NextIntlClientProvider locale="zh" messages={zh} timeZone="Asia/Hong_Kong">
    <CharacterVoiceBinding character={{ id: 'hero', name: '苏砚', gender: '男', voice_id: voiceId, voice_name: '清朗男声' }}
      seriesId="series" onSave={save} />
  </NextIntlClientProvider>);
}

it('opens the existing library and saves only the voice binding after explicit apply', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  setup(save);
  fireEvent.click(screen.getByRole('button', { name: /音色库/ }));
  fireEvent.click(await screen.findByText('沉稳男声'));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '应用' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ voice_id: 'uniart:speech-2.8-hd:male-qn-jingying', voice_name: '沉稳男声' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '应用' })).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: /音色库/ })).toHaveTextContent('沉稳男声');
});

it('keeps the current binding and selected replacement when saving fails, then allows retry', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('保存失败')).mockResolvedValueOnce(undefined);
  setup(save);
  fireEvent.click(screen.getByRole('button', { name: /音色库/ }));
  fireEvent.click(await screen.findByText('沉稳男声'));
  fireEvent.click(screen.getByRole('button', { name: '应用' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
  expect(screen.getByRole('button', { name: /音色库/ })).toHaveTextContent('清朗男声');
  fireEvent.click(screen.getByRole('button', { name: '应用' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '应用' })).not.toBeInTheDocument());
  expect(save).toHaveBeenCalledTimes(2);
});

it('does not save a selection when the chooser is cancelled', async () => {
  const save = vi.fn();
  setup(save);
  fireEvent.click(screen.getByRole('button', { name: /音色库/ }));
  fireEvent.click(await screen.findByText('沉稳男声'));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(save).not.toHaveBeenCalled();
});

it('prevents repeated apply while the binding is being saved', async () => {
  let finish!: () => void;
  const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  setup(save);
  fireEvent.click(screen.getByRole('button', { name: /音色库/ }));
  fireEvent.click(await screen.findByText('沉稳男声'));
  fireEvent.click(screen.getByRole('button', { name: '应用' }));
  expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '保存中…' }));
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});

it('discards a pending audition after closing the library', async () => {
  let finish!: (result: { url: string }) => void;
  mocks.previewVoice.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const audio = vi.fn();
  vi.stubGlobal('Audio', audio);
  setup(vi.fn());
  fireEvent.click(screen.getByRole('button', { name: /音色库/ }));
  await screen.findByText('沉稳男声');
  fireEvent.click(screen.getAllByRole('button', { name: '播放试听' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await act(async () => finish({ url: '/output/voice.wav' }));
  expect(audio).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('shows gateway model groups and does not call legacy custom voice management', async () => {
  mocks.getVoices.mockResolvedValueOnce([
    { id: 'uniart:speech-2.8-hd:male-qn-qingse', name: 'HD青年', gender: 'Male', family: 'minimax', model: 'speech-2.8-hd', origin: 'system' },
    { id: 'uniart:speech-2.8-turbo:male-qn-qingse', name: 'Turbo青年', gender: 'Male', family: 'minimax', model: 'speech-2.8-turbo', origin: 'system' },
  ]);
  setup(vi.fn(), 'longcheng_v2');
  fireEvent.click(screen.getByRole('button', { name: /音色库/ }));
  expect(await screen.findByText(/UniArt · MiniMax HD/)).toBeInTheDocument();
  expect(screen.getByText(/UniArt · MiniMax Turbo/)).toBeInTheDocument();
  expect(screen.getByText(/原音色不兼容/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
  expect(screen.queryByText('我的复刻')).not.toBeInTheDocument();
  expect(mocks.listCustomVoices).not.toHaveBeenCalled();
});

it('keeps available voices visible after an audition fails', async () => {
  mocks.previewVoice.mockRejectedValueOnce(new Error('网关请求失败'));
  setup(vi.fn());
  fireEvent.click(screen.getByRole('button', { name: /音色库/ }));
  await screen.findByText('沉稳男声');
  fireEvent.click(screen.getAllByRole('button', { name: '播放试听' })[0]);
  expect(await screen.findByRole('alert')).toHaveTextContent('网关请求失败');
  expect(screen.getByText('沉稳男声')).toBeInTheDocument();
  fireEvent.click(screen.getByText('沉稳男声'));
  expect(screen.getByRole('button', { name: '应用' })).toBeEnabled();
});


it('retires the visible old binding and replaces it only after explicit apply', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  setup(save, 'longcheng_v2');
  expect(screen.getByRole('button', { name: /音色库/ })).toHaveTextContent('旧音色已停用');
  expect(screen.queryByText('longcheng_v2')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /音色库/ }));
  await screen.findByText('沉稳男声');
  expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
  expect(screen.queryByText('longcheng_v2')).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('沉稳男声'));
  fireEvent.click(screen.getByRole('button', { name: '应用' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({
    voice_id: 'uniart:speech-2.8-hd:male-qn-jingying', voice_name: '沉稳男声',
  }));
  await waitFor(() => expect(screen.getByRole('button', { name: /音色库/ })).toHaveTextContent('沉稳男声'));
});

it('searches and filters the expanded catalog without losing the selected binding', async () => {
  const voice = (id: string, name: string, language: string) => ({
    id: `uniart:speech-2.8-hd:${id}`, name, gender: 'Unknown', family: 'minimax',
    model: 'speech-2.8-hd', origin: 'system', lang_primary: language,
  });
  mocks.getVoices.mockResolvedValueOnce([
    ...Array.from({ length: 50 }, (_, i) => voice(`voice_${i}`, `普通话${i}`, 'zh')),
    voice('Chinese (Mandarin)_Gentleman', '温润男声', 'zh'),
    voice('Cantonese_ProfessionalHost（F)', '专业女主持', 'yue'),
  ]);
  const save = vi.fn().mockResolvedValue(undefined);
  setup(save);
  fireEvent.click(screen.getByRole('button', { name: /音色库/ }));
  await screen.findByText('普通话0');
  expect(screen.queryByText('温润男声')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '显示更多' }));
  fireEvent.click(screen.getByText('温润男声'));
  fireEvent.change(screen.getByRole('combobox', { name: '语言' }), { target: { value: 'yue' } });
  expect(screen.getByText('专业女主持')).toBeInTheDocument();
  expect(screen.queryByRole('radio', { name: /温润男声/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '应用' })).toBeEnabled();
  fireEvent.change(screen.getByRole('combobox', { name: '语言' }), { target: { value: '' } });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Chinese (Mandarin)_Gentleman' } });
  expect(screen.getByRole('radio', { name: /温润男声/ })).toHaveAttribute('aria-checked', 'true');
  expect(screen.queryByText('专业女主持')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '应用' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({
    voice_id: 'uniart:speech-2.8-hd:Chinese (Mandarin)_Gentleman', voice_name: '温润男声',
  }));
});


it('recognizes every published system binding while rejecting legacy or malformed bindings', async () => {
  for (const id of ['clever_boy', 'Chinese (Mandarin)_Gentleman', 'Cantonese_ProfessionalHost（F)']) {
    expect(isUniArtVoiceBinding(`uniart:speech-2.8-hd:${id}`)).toBe(true);
    expect(isUniArtVoiceBinding(`uniart:speech-2.8-turbo:${id}`)).toBe(true);
  }
  for (const id of ['longcheng_v2', 'uniart:other:male-qn-qingse', 'uniart:speech-2.8-hd:a:b']) {
    expect(isUniArtVoiceBinding(id)).toBe(false);
  }
});
