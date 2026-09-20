import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
import UpdateChecker from './UpdateChecker';
import IFrameBranding from '../layout/IFrameBranding';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('keeps update checking inactive without network requests', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<NextIntlClientProvider locale="en" messages={messages}><UpdateChecker /></NextIntlClientProvider>);
  const button = screen.getByRole('button');
  expect(button).toBeDisabled(); fireEvent.click(button);
  expect(screen.getByRole('status')).toHaveTextContent('Inactive');
  expect(fetch).not.toHaveBeenCalled();
});
it('uses the supplied iFrame logo and attribution', () => {
  render(<IFrameBranding />);
  expect(screen.getByRole('img', { name: 'iFrame' })).toHaveAttribute('src', 'iframe-logo.png');
  expect(screen.getByText('Powered by Lumenx & Uniart')).toBeInTheDocument();
});
