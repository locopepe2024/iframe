// @vitest-environment happy-dom

import { afterEach, expect, it } from 'vitest';
import { useProjectStore } from '@/store/projectStore';

afterEach(() => {
    useProjectStore.setState({ projects: [], currentProject: null, generatingTasks: [] });
    localStorage.removeItem('project-storage');
});

it('keeps generated image payloads out of localStorage when projects change', () => {
    const project = {
        id: 'episode', title: 'Episode', scenes: [], props: [], characters: [{
            id: 'character', name: 'Character', reference_sheet: {
                image_variants: Array.from({ length: 4 }, (_, index) => ({
                    id: `variant-${index}`, url: `data:image/png;base64,${'x'.repeat(300_000)}`,
                })),
            },
        }],
    };
    useProjectStore.setState({ projects: [project] as any, currentProject: project as any });
    expect(useProjectStore.getState().projects[0].characters[0].reference_sheet?.image_variants).toHaveLength(4);
    expect(localStorage.getItem('project-storage')?.length || 0).toBeLessThan(1000);

    useProjectStore.getState().addGeneratingTask('character', 'reference_sheet', 4);
    expect(() => useProjectStore.getState().removeGeneratingTask('character', 'reference_sheet')).not.toThrow();
});

it('discards old persisted project snapshots during migration', async () => {
    localStorage.setItem('project-storage', JSON.stringify({
        state: { projects: [{ id: 'legacy', title: 'Legacy', characters: [{ image: 'x'.repeat(10_000) }] }] },
        version: 2,
    }));
    await useProjectStore.persist.rehydrate();
    expect(useProjectStore.getState().projects).toEqual([]);
    expect(localStorage.getItem('project-storage')?.length || 0).toBeLessThan(1000);
});
