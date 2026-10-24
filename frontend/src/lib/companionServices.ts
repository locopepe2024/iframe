import { API_URL, authenticatedFetch } from "./api";
const base=`${API_URL}/companion-agent-api/companion-runtime`;
async function request(path:string, body?:unknown, method=body===undefined?"GET":"POST") {
  const response=await authenticatedFetch(base+path,{method,credentials:"include",cache:"no-store",...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});
  if(!response.ok)throw new Error(response.status===409?"请检查个人渠道配置或原请求状态。":response.status===422?"所选模型或参数暂不支持，请调整后重试。":"服务暂不可用，请检查 UniArt 渠道。失败请求不会自动重新生成。");
  return response;
}
export interface ServiceModel { id:string; display_name:string; capabilities:string[]; duration?:{min:number;max:number}; }
export interface GenerationJob {id:string;status:string;mode?:string}
export const companionServices={
  channel:async():Promise<{configured:boolean;base_url:string}> => (await request("/channel")).json(),
  saveChannel:async(base_url:string,api_key?:string)=>(await request("/channel",{base_url,api_key},"PUT")).json(),
  models:async():Promise<{models:ServiceModel[]}> => (await request("/channel/models")).json(),
  generate:async(body:object):Promise<GenerationJob> => (await request("/generations",body)).json(),
  job:async(id:string):Promise<GenerationJob> => (await request(`/generations/${encodeURIComponent(id)}`)).json(),
  media:async(id:string) => (await request(`/generations/${encodeURIComponent(id)}/media`)).blob(),
  speech:async(text:string) => (await request("/speech",{text,allow_external_text:true})).blob(),
};
