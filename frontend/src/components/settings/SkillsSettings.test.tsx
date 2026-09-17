import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SkillsSettings, { type CreativeSkill } from './SkillsSettings';
import { agentRequest } from '@/lib/api';

vi.mock('next-intl', () => ({ useLocale: () => 'zh' }));
vi.mock('@/lib/api', () => ({ agentRequest: vi.fn() }));
const skill: CreativeSkill = { id: 'camera', name: 'Seedance 运镜', category: '运镜', targets: ['Seedance'], description: '运镜设计', version: '1.0.0', source: 'https://github.com/test/skills', source_revision: 'a'.repeat(40), revision: 'b'.repeat(64), license: 'MIT', license_text: 'MIT license', adaptation: 'iFrame 改编', instructions: 'Camera instructions' };
let saved: CreativeSkill[];
beforeEach(() => {
  saved = [];
  vi.mocked(agentRequest).mockReset();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.mocked(agentRequest).mockImplementation(async (_path, method = 'GET', body) => {
    if (method === 'POST') saved = [{ ...skill, enabled: true }];
    if (method === 'PATCH') saved = [{ ...skill, enabled: (body as { enabled: boolean }).enabled }];
    if (method === 'DELETE') saved = [];
    return { catalog: [skill], installed: saved } as never;
  });
});

it('fetches, previews, searches and installs a Skill then persists toggle and uninstall', async () => {
  render(<SkillsSettings />);
  await screen.findByText('暂无已安装 Skill');
  fireEvent.click(screen.getByRole('button', { name: '获取 Skill' }));
  await screen.findByRole('button', { name: '安装 Seedance 运镜' });
  fireEvent.change(screen.getByRole('textbox', { name: '搜索 Skill' }), { target: { value: 'missing' } });
  expect(screen.getByText('没有匹配的 Skill')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索 Skill' }), { target: { value: 'Seedance' } });
  fireEvent.click(screen.getByText('内容与来源'));
  expect(screen.getByText('Camera instructions')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '安装 Seedance 运镜' }));
  await screen.findByRole('button', { name: '已安装 Seedance 运镜' });
  expect(agentRequest).toHaveBeenCalledWith('/skills/camera', 'POST', { revision: skill.revision });
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '启用 Seedance 运镜' }));
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
  fireEvent.click(screen.getByRole('button', { name: '卸载 Seedance 运镜' }));
  await screen.findByText('暂无已安装 Skill');
  expect(agentRequest).toHaveBeenCalledWith('/skills/camera', 'DELETE', undefined);
});

it('shows install failure without falsely marking the Skill installed', async () => {
  render(<SkillsSettings />);
  await screen.findByText('暂无已安装 Skill');
  fireEvent.click(screen.getByRole('button', { name: '获取 Skill' }));
  const install = await screen.findByRole('button', { name: '安装 Seedance 运镜' });
  vi.mocked(agentRequest).mockRejectedValueOnce(new Error('安装失败'));
  fireEvent.click(install);
  expect(await screen.findByRole('alert')).toHaveTextContent('安装失败');
  expect(screen.getByRole('button', { name: '安装 Seedance 运镜' })).toBeEnabled();
});

it('does not let an older catalog response erase a successful installation', async () => {
  let finishOldRequest!: (value: unknown) => void;
  vi.mocked(agentRequest).mockImplementationOnce(() => new Promise(resolve => { finishOldRequest = resolve; }));
  render(<SkillsSettings />);
  fireEvent.click(screen.getByRole('button', { name: '获取 Skill' }));
  fireEvent.click(await screen.findByRole('button', { name: '安装 Seedance 运镜' }));
  await screen.findByRole('button', { name: '已安装 Seedance 运镜' });
  await act(async () => { finishOldRequest({ catalog: [skill], installed: [] }); });
  await waitFor(() => expect(screen.queryByRole('button', { name: '安装 Seedance 运镜' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.getByRole('checkbox', { name: '启用 Seedance 运镜' })).toBeChecked();
});
