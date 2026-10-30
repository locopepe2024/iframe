import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import MediaViewer from './MediaViewer';
import {createInteractionFocus,InteractionFocusContext} from './InteractionFocus';
const api=vi.hoisted(()=>({image:vi.fn(),media:vi.fn()}));
vi.mock('@/lib/photoApi',()=>({photoApi:api}));
vi.mock('@/lib/companionMediaApi',()=>({companionMediaApi:api}));
vi.mock('../photos/PhotoContent',()=>({default:({photoId}:{photoId:string})=><p>资料 {photoId}</p>}));
vi.mock('../photos/PhotoStory',()=>({default:({photoId}:{photoId:string})=><p>讲述 {photoId}</p>}));
const items=[{id:'one',kind:'photo' as const,name:'第一张'},{id:'two',kind:'photo' as const,name:'第二张'}];
beforeEach(()=>{vi.resetAllMocks();api.image.mockResolvedValue(new Blob());api.media.mockResolvedValue(new Blob());});
it('loads originals, keeps viewing separate from selection and navigates only this result set',async()=>{
 const use=vi.fn();render(<MediaViewer items={items} onUse={use} onClose={()=>{}}/>);
 await screen.findByAltText('第一张');
 expect(api.image).toHaveBeenCalledWith('one',true);
 expect(use).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'上一张'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'放大照片'}));expect(screen.getByText('150%')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'下一张'}));await screen.findByAltText('第二张');
 expect(screen.getByText('100%')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'下一张'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'使用这张照片'}));expect(use).toHaveBeenCalledWith(items[1]);
});
it('opens details only on request and cancels back to the image before closing the viewer',async()=>{
 const close=vi.fn();render(<MediaViewer items={items} onClose={close}/>);
 await screen.findByAltText('第一张');expect(screen.queryByText('资料 one')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'查看照片资料'}));expect(screen.getByText('资料 one')).toBeInTheDocument();
 fireEvent(screen.getByRole('dialog'),new Event('cancel',{cancelable:true}));
 await screen.findByAltText('第一张');expect(close).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'返回相册'}));expect(close).toHaveBeenCalledOnce();
});
it('uses the video original without auto playing and exposes a retry after media failure',async()=>{
 api.media.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Blob());
 render(<MediaViewer items={[{id:'v',kind:'video',name:'公园视频'}]} onClose={()=>{}}/>);
 await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'重试打开'}));
 const video=await screen.findByLabelText('公园视频');
 expect(video.tagName).toBe('VIDEO');expect(video).toHaveAttribute('controls');expect(video).not.toHaveAttribute('autoplay');
 expect(api.media).toHaveBeenCalledWith('v',true);
 expect(screen.queryByRole('button',{name:'放大照片'})).not.toBeInTheDocument();
});
it('ignores stale original downloads after moving to another photo',async()=>{
 let resolve!:(blob:Blob)=>void;
 api.image.mockReturnValueOnce(new Promise<Blob>(done=>{resolve=done;}));
 render(<MediaViewer items={items} onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'下一张'}));await screen.findByAltText('第二张');
 resolve(new Blob());await waitFor(()=>expect(screen.queryByAltText('第一张')).not.toBeInTheDocument());
});

it('publishes the visible photo as voice focus and restores chat when closed',async()=>{
 const focus=createInteractionFocus();
 const view=render(<InteractionFocusContext.Provider value={focus}><MediaViewer items={items} onClose={()=>{}}/></InteractionFocusContext.Provider>);
 expect(focus.current()).toMatchObject({kind:'photo',object_id:'one',phase:'viewing'});
 fireEvent.click(screen.getByRole('button',{name:'下一张'}));
 expect(focus.current()).toMatchObject({kind:'photo',object_id:'two'});
 view.unmount();expect(focus.current().kind).toBe('chat');
});
