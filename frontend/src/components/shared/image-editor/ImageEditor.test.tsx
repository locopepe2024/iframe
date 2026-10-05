import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/en.json';
import ImageEditor from './ImageEditor';

vi.mock('next/dynamic', () => ({ default: () => function Engine(props: { onModify: () => void; onSave: (value: unknown) => void }) {
  return <><button onClick={props.onModify}>Modify</button><button onClick={() => props.onSave({ imageBase64: 'data:image/png;base64,YQ==', mimeType: 'image/png' })}>Save copy</button></>;
} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const mount = (onSave: (file: File) => Promise<void>, onClose = vi.fn()) => {
  render(<NextIntlClientProvider locale="en" messages={messages}><ImageEditor source="blob:owned-source" title="product.png" onSave={onSave} onClose={onClose} /></NextIntlClientProvider>);
  return onClose;
};
it('retains editing on save failure and exports a new filename', async () => {
  const save = vi.fn().mockRejectedValue(new Error('offline')); const close = mount(save);
  fireEvent.click(screen.getByRole('button', { name: 'Edit image' }));
  fireEvent.click(screen.getByText('Modify')); fireEvent.click(screen.getByText('Save copy'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your edits are retained');
  expect(save.mock.calls[0][0].name).toBe('product-edited.png');
  expect(close).not.toHaveBeenCalled(); expect(screen.getByText('Save copy')).not.toBeDisabled();
});
it('blocks repeated saves and closing while a save is pending', async () => {
  let complete!: () => void;
  const save=vi.fn(() => new Promise<void>(resolve => { complete=resolve; })); const close=mount(save);
  fireEvent.click(screen.getByRole('button', { name: 'Edit image' }));
  fireEvent.click(screen.getByText('Save copy')); await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText('Save copy')); fireEvent.click(screen.getByLabelText('Close image editor'));
  expect(save).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
  complete(); await waitFor(() => expect(screen.getByText('Save copy')).not.toBeDisabled());
});
it('requires confirmation before discarding unsaved edits', () => {
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false); const close=mount(vi.fn());
  fireEvent.click(screen.getByRole('button', { name: 'Edit image' }));
  fireEvent.click(screen.getByText('Modify')); fireEvent.click(screen.getByLabelText('Close image editor'));
  expect(confirm).toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); fireEvent.click(screen.getByLabelText('Close image editor')); expect(close).toHaveBeenCalledTimes(1);
});
it('confirms before leaving local editing and clears the discarded state', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const onDiscard = vi.fn();
  render(<NextIntlClientProvider locale="en" messages={messages}><ImageEditor source="blob:owned-source" title="product.png" onSave={vi.fn()} onClose={vi.fn()} onDiscard={onDiscard}/></NextIntlClientProvider>);
  fireEvent.click(screen.getByText('Modify'));
  fireEvent.click(screen.getByRole('button', { name: 'Canvas preview' }));
  expect(screen.getByText('Modify')).toBeInTheDocument();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Canvas preview' }));
  expect(screen.queryByText('Modify')).not.toBeInTheDocument();
  expect(onDiscard).toHaveBeenCalledTimes(1);
});

it('saves an untouched 2:1 source through an explicit panorama action without a projection selector', async () => {
  const saveOriginal = vi.fn().mockResolvedValue(undefined);
  render(<NextIntlClientProvider locale="en" messages={messages}><ImageEditor source="blob:panorama" title="room.png" panoramaEligible onSavePanoramaSource={saveOriginal} onSave={vi.fn()} onClose={vi.fn()}/></NextIntlClientProvider>);
  expect(screen.queryByRole('combobox', { name: 'Projection' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save as panorama' }));
  await waitFor(() => expect(saveOriginal).toHaveBeenCalledTimes(1));
});

it('allows a non-2:1 candidate to browse but blocks panorama saving', () => {
  render(<NextIntlClientProvider locale="en" messages={messages}><ImageEditor source="blob:candidate" title="candidate.png" panoramaCandidate panoramaEligible panoramaSaveEligible={false} initialView="panorama" onSave={vi.fn()} onClose={vi.fn()}/></NextIntlClientProvider>);
  expect(screen.getByRole('button', { name: 'Browse panorama' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('status')).toHaveTextContent('not exactly 2:1');
  expect(screen.queryByRole('button', { name: 'Save as panorama' })).not.toBeInTheDocument();
});

it('shows only the selected image in the canvas preview', () => {
  render(<NextIntlClientProvider locale="en" messages={messages}><ImageEditor source="blob:result" initialView="preview" title="result.png" onSave={vi.fn()} onClose={vi.fn()}/></NextIntlClientProvider>);
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(screen.getByRole('img', { name: 'result.png' })).toHaveAttribute('src', 'blob:result');
});

it('opens a drawable annotation canvas and a separate source-bound mask canvas', () => {
  const mask = { strokes: [], rect: null };
  render(<NextIntlClientProvider locale="en" messages={messages}><ImageEditor source="blob:result" title="result.png" maskMarking={mask} onMaskChange={vi.fn()} sourceDimensions={{ width: 32, height: 24 }} onSave={vi.fn()} onClose={vi.fn()}/></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Annotate' }));
  expect(screen.getByLabelText('标注画布')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save annotated copy' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Mask' }));
  expect(screen.getByLabelText('蒙板画布')).toBeInTheDocument();
});

it('isolates the background and restores focus without trapping engine portals in a native modal', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const close = mount(vi.fn());
  expect(opener.inert).toBe(true);
  expect(screen.getByRole('dialog').tagName).toBe('DIV');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(1);
  cleanup();
  expect(opener.inert).toBeFalsy(); expect(document.activeElement).toBe(opener);
  opener.remove();
});
