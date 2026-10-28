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
