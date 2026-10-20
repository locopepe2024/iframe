import { expect, it } from 'vitest';
import { templateDimensions } from '@/lib/promptTemplateCategories';

it('keeps commercial tasks independent of costume topics and rendering styles', () => {
  expect(templateDimensions('古装女装电商主图', '真人写实 国风')).toEqual({
    tasks: ['commerce'], topics: ['古装', '国风'], styles: ['真人写实'],
  });
});
it('classifies legacy character templates without treating all styles as the same task', () => {
  expect(templateDimensions('二次元国漫古装')).toEqual({ tasks: ['character'], topics: ['古装'], styles: ['动漫'] });
  expect(templateDimensions('换装写真', '现代摄影')).toEqual({ tasks: ['outfit', 'portrait'], topics: ['现代'], styles: ['真人写实'] });
});
