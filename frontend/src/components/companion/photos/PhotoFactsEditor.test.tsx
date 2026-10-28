import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import PhotoFactsEditor from './PhotoFactsEditor';
const api=vi.hoisted(()=>({annotations:vi.fn(),saveAnnotations:vi.fn()}));
vi.mock('@/lib/photoApi',()=>({photoApi:api}));
const facts={people:[],scene:'院子',lighting:'',location:'杭州',latitude:null,longitude:null,capture_time:'2026-10-28',notes:''};
beforeEach(()=>{vi.resetAllMocks();api.annotations.mockResolvedValue({revision:2,facts});});
it('requires explicit save and preserves the same request after an uncertain response',async()=>{
 api.saveAnnotations.mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce({revision:3,facts:{...facts,location:'苏州'}});
 render(<PhotoFactsEditor photoId="p"/>);
 fireEvent.change(await screen.findByLabelText('地点'),{target:{value:'苏州'}});
 expect(api.saveAnnotations).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'保存照片资料'}));
 await screen.findByRole('alert');
 expect(screen.getByLabelText('地点')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'重试原保存'}));
 await screen.findByText('照片资料已保存。');
 expect(api.saveAnnotations.mock.calls[0]).toEqual(api.saveAnnotations.mock.calls[1]);
 expect(api.saveAnnotations.mock.calls[0][1]).toMatchObject({expected_revision:2,facts:{location:'苏州'}});
});
it('blocks a stale agent proposal instead of overwriting newer user facts',async()=>{
 render(<PhotoFactsEditor photoId="p" initialPatch={{location:'旧地点'}} expectedRevision={1}/>);
 await screen.findByText('照片资料已有更新，请重新提出修改。');
 expect(screen.queryByRole('button',{name:'保存照片资料'})).not.toBeInTheDocument();
 expect(api.saveAnnotations).not.toHaveBeenCalled();
});
it('keeps the editor unavailable when the authoritative record cannot be loaded',async()=>{
 api.annotations.mockRejectedValue(new Error('offline'));
 render(<PhotoFactsEditor photoId="p"/>);
 await waitFor(()=>expect(screen.getByRole('alert')).toBeInTheDocument());
 expect(screen.queryByLabelText('地点')).not.toBeInTheDocument();
});

const analysis = {model:'fixture',provider:'qwen' as const,status:'needs_review' as const,created_at:'now',observation:{scene:'树下的庭院',lighting:'柔和自然光',time_clues:'可能是秋季',visible_summary:'人物站在树下',visible_text:[],uncertainties:[],story_question:'这是什么时候？',people:[{reference:'p1',position:'中央',appearance:'束发',clothing:'绿袍',activity:'站立'}]}};
it('prefills only visible draft fields and saves them only after confirmation',async()=>{
 api.annotations.mockResolvedValue({revision:0,facts:{...facts,scene:'',location:'',capture_time:''}});
 api.saveAnnotations.mockImplementation(async(_id,body)=>({revision:1,facts:body.facts}));
 render(<PhotoFactsEditor photoId="p" analysis={analysis}/>);
 await waitFor(()=>expect(screen.getByLabelText('场景')).toHaveValue('树下的庭院'));
 expect(screen.getByLabelText('光影')).toHaveValue('柔和自然光');
 expect(screen.getByLabelText('画面位置')).toHaveValue('p1 中央');
 expect(screen.getByLabelText('姓名')).toHaveValue('');
 expect(screen.getByLabelText('年龄')).toHaveValue(null);
 expect(screen.getByLabelText('拍摄时间')).toHaveValue('');
 expect(api.saveAnnotations).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('场景'),{target:{value:'公园'}});
 fireEvent.click(screen.getByRole('button',{name:'保存照片资料'}));
 await screen.findByText('照片资料已保存。');
 expect(api.saveAnnotations.mock.calls[0][1].facts.scene).toBe('公园');
});
it('does not replace saved facts or cleared values with analysis',async()=>{
 render(<PhotoFactsEditor photoId="p" analysis={analysis}/>);
 await screen.findByLabelText('场景');
 expect(screen.getByLabelText('场景')).toHaveValue('院子');
 expect(screen.getByLabelText('光影')).toHaveValue('');
 expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
});
it('does not overwrite an ongoing manual draft when analysis arrives',async()=>{
 api.annotations.mockResolvedValue({revision:0,facts:{...facts,scene:''}});
 const view=render(<PhotoFactsEditor photoId="p"/>);
 fireEvent.change(await screen.findByLabelText('场景'),{target:{value:'我的场景'}});
 view.rerender(<PhotoFactsEditor photoId="p" analysis={analysis}/>);
 expect(screen.getByLabelText('场景')).toHaveValue('我的场景');
 expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
});
