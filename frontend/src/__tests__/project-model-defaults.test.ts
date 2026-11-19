import { afterEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({createProject:vi.fn(),updateModelSettings:vi.fn(),getProject:vi.fn(),refresh:vi.fn(),resolve:vi.fn()}));
vi.mock('@/lib/api',()=>({api:{createProject:mocks.createProject,updateModelSettings:mocks.updateModelSettings,getProject:mocks.getProject},API_URL:''}));
vi.mock('@/lib/modelCatalog',()=>({refreshUniArtModelCatalog:mocks.refresh,resolveModelSettings:mocks.resolve}));
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();vi.clearAllMocks();});
it.each([0,1])('does not inject a previous provider default when catalog load returns %s',async loaded=>{
 const values=new Map([['lumenx_default_model_settings',JSON.stringify({t2i_model:'uniart/gpt-image-2'})]]);
 vi.stubGlobal('window',{});
 vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:vi.fn(),removeItem:vi.fn()});
 mocks.createProject.mockResolvedValue({id:'project',model_settings:{t2i_model:'nsfw/owner-image'}});
 mocks.getProject.mockResolvedValue({id:'project'});mocks.refresh.mockResolvedValue(loaded);
 mocks.resolve.mockReturnValue({t2i_model:'nsfw/owner-image',i2i_model:'nsfw/owner-image',image_model:'nsfw/owner-image',i2v_model:'nsfw/owner-video',r2v_model:'nsfw/owner-video'});
 const {useProjectStore}=await import('@/store/projectStore');
 await useProjectStore.getState().createProject('title','text',true);
 expect(mocks.refresh).toHaveBeenCalledOnce();
 expect(mocks.updateModelSettings.mock.calls[0][1]).toBe(loaded?'nsfw/owner-image':undefined);
 expect(mocks.updateModelSettings.mock.calls[0]).not.toContain('uniart/gpt-image-2');
});
