import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Home from '@/app/page';

const { state, getProjects, getSeriesEpisodes } = vi.hoisted(() => ({
  state: {
    projects: [] as any[], seriesList: [] as any[], deleteProject: vi.fn(), deleteSeries: vi.fn(),
    setProjects: vi.fn(), fetchSeriesList: vi.fn(),
  },
  getProjects: vi.fn(), getSeriesEpisodes: vi.fn(),
}));
vi.mock('@/store/projectStore', () => ({ useProjectStore: (selector: any) => selector(state) }));
vi.mock('@/lib/api', () => ({ api: { getProjects, getSeriesEpisodes } }));
vi.mock('@/lib/useOnline', () => ({ useOnline: () => true }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('framer-motion', () => ({ motion: { div: ({ children, initial, animate, ...props }: any) => <div {...props}>{children}</div> } }));
vi.mock('@/components/layout/AppShell', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('@/components/canvas/CreativeCanvas', () => ({ default: () => null }));
vi.mock('@/components/layout/TauriMenuListener', () => ({ default: () => null }));
vi.mock('@/components/project/CreateProjectDialog', () => ({ default: () => null }));
vi.mock('@/components/project/EnvConfigDialog', () => ({ default: () => null }));
vi.mock('@/components/project/ProjectCard', () => ({
  default: ({ project }: any) => <div data-testid="project-card">{project.title}</div>,
  deriveStatus: () => 'pending', deriveCover: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '#/';
  state.projects = Array.from({ length: 60 }, (_, index) => ({
    id: `episode-${index + 1}`, title: `第${index + 1}集`, series_id: 'series-60', episode_number: index + 1,
  }));
  state.seriesList = [];
  getProjects.mockResolvedValue(state.projects);
  getSeriesEpisodes.mockResolvedValue(state.projects);
});

it('keeps 60 episodes out of standalone projects while series metadata is missing and after it arrives', async () => {
  const { rerender } = render(<Home />);
  await waitFor(() => expect(state.fetchSeriesList).toHaveBeenCalled());
  expect(screen.queryByRole('region', { name: 'standaloneGroup' })).not.toBeInTheDocument();
  expect(screen.queryAllByTestId('project-card')).toHaveLength(0);
  expect(screen.getByRole('status')).toHaveTextContent('seriesMetadataPending');
  expect(screen.queryByText('emptyHint')).not.toBeInTheDocument();

  state.seriesList = [{ id: 'series-60', title: '武林传', episode_ids: state.projects.map(p => p.id) }];
  rerender(<Home />);
  expect(await screen.findByRole('region', { name: '武林传' })).toBeInTheDocument();
  await waitFor(() => expect(getSeriesEpisodes).toHaveBeenCalledWith('series-60'));
  expect(screen.queryByText('seriesMetadataPending')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'standaloneGroup' })).not.toBeInTheDocument();
});

it('continues to show a genuinely independent project while series metadata is unavailable', async () => {
  state.projects = [...state.projects, { id: 'standalone', title: '独立短片' }];
  render(<Home />);
  const section = await screen.findByRole('region', { name: 'standaloneGroup' });
  expect(section).toHaveTextContent('独立短片');
  expect(screen.getAllByTestId('project-card')).toHaveLength(1);
  expect(section).not.toHaveTextContent('第1集');
  expect(screen.getByRole('status')).toHaveTextContent('seriesMetadataPending');
});
