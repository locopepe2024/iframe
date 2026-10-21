import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import zh from '../../../../messages/zh.json';
import CharacterVoiceBinding from './CharacterVoiceBinding';

const mocks = vi.hoisted(() => ({
  getVoices: vi.fn().mockResolvedValue([
    { id: 'voice-a', name: '清朗男声', gender: 'Male', family: 'cosyvoice', origin: 'system', model: 'cosyvoice-v3-flash' },
    { id: 'voice-b', name: '沉稳男声', gender: 'Male', family: 'cosyvoice', origin: 'system', model: 'cosyvoice-v3-flash' },
  ]),
  listCustomVoices: vi.fn().mockResolvedValue([]),
  previewVoice: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: mocks }));

function setup(save: (attributes: Record<string, unknown>) => Promise<void>) {
  return render(<NextIntlClientProvider locale="zh" messages={zh} timeZone="Asia/Hong_Kong">
    <CharacterVoiceBinding character={{ id: 'hero', name: '苏砚', gender: '男', voice_id: 'voice-a', voice_name: '清朗男声' }}
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
  await waitFor(() => expect(save).toHaveBeenCalledWith({ voice_id: 'voice-b', voice_name: '沉稳男声' }));
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
