import {act,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import AgentChat from "./AgentChat";
const api=vi.hoisted(()=>({session:vi.fn(),messages:vi.fn(),diaries:vi.fn(),chat:vi.fn()}));
const services=vi.hoisted(()=>({models:vi.fn(),generate:vi.fn(),media:vi.fn()}));
vi.mock("@/lib/companionApi",()=>({companionApi:api}));
vi.mock("@/lib/companionServices",()=>({companionServices:services}));
vi.mock("./UniArtSettings",()=>({default:()=>null}));
let recognition: Recognition;
class Recognition {
 lang="";continuous=false;interimResults=false;
 onresult:((event:{results:{transcript:string}[][]})=>void)|null=null;
 onend:(()=>void)|null=null;onerror:(()=>void)|null=null;
 start=vi.fn();stop=vi.fn();abort=vi.fn();
 constructor(){recognition=this;}
}
beforeEach(()=>{
 localStorage.clear();vi.resetAllMocks();
 Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:Recognition});
 api.session.mockResolvedValue({session_id:"s"});api.messages.mockResolvedValue({messages:[],next_after:null});api.diaries.mockResolvedValue({diaries:[]});
 services.models.mockResolvedValue({models:[{id:"image",display_name:"图片模型",capabilities:["t2i"]},{id:"video",display_name:"视频模型",capabilities:["t2v"]}]});
 services.generate.mockResolvedValue({id:"result",status:"completed"});services.media.mockResolvedValue(new Blob(["media"]));
 URL.createObjectURL=vi.fn(()=>"blob:generated");URL.revokeObjectURL=vi.fn();
});
afterEach(()=>{delete (window as Window & {SpeechRecognition?:unknown}).SpeechRecognition;});
it.each([ ["图片","image","想生成的图片","方形 1:1"], ["视频","video","想生成的视频","5 秒"] ])("dictates and explicitly generates %s through the actual cards",async(label,mode,inputLabel,setting)=>{
 const view=render(<AgentChat/>);
 await waitFor(()=>expect(screen.getByRole("button",{name:"创作类型：聊天"})).not.toBeDisabled());
 fireEvent.click(screen.getByRole("button",{name:"创作类型：聊天"}));fireEvent.click(screen.getByRole("menuitemradio",{name:label}));
 fireEvent.click(screen.getByRole("button",{name:"语音输入"}));fireEvent.click(screen.getByRole("button",{name:"同意并开始听写"}));
 act(()=>{recognition.onresult?.({results:[[{transcript:"阳光下的花园"}]]});recognition.onend?.();});
 expect(screen.getByLabelText(inputLabel)).toHaveValue("阳光下的花园");
 expect(api.chat).not.toHaveBeenCalled();expect(services.generate).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText(inputLabel),{target:{value:"阳光下的花园，有蝴蝶"}});
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 expect(screen.getByLabelText(inputLabel)).toHaveValue("");
 fireEvent.click(screen.getByRole("button",{name:"返回修改描述"}));
 expect(screen.getByLabelText(inputLabel)).toHaveValue("阳光下的花园，有蝴蝶");
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 fireEvent.click(screen.getByRole("button",{name:"取消创作"}));
 expect(screen.getByLabelText(inputLabel)).toHaveValue("阳光下的花园，有蝴蝶");
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 expect(screen.getByLabelText(inputLabel)).toHaveValue("");
 const guide=screen.getByRole("region",{name:`${label}创作引导`});
 fireEvent.click(within(guide).getByRole("button",{name:"不加参考图片"}));
 fireEvent.click(within(guide).getByRole("button",{name:setting}));
 expect(services.generate).not.toHaveBeenCalled();
 fireEvent.click(within(guide).getByRole("button",{name:"确认设置"}));
 fireEvent.click(screen.getByRole("button",{name:"读取我的可用模型"}));
 await screen.findByRole("option",{name:`${label}模型`});
 fireEvent.change(screen.getByLabelText("生成模型"),{target:{value:mode}});
 expect(services.generate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"确认生成（可能计费）"}));
 await screen.findByText("生成完成。");
 expect(services.generate).toHaveBeenCalledOnce();
 expect(services.generate).toHaveBeenCalledWith(expect.objectContaining({mode,model:mode,prompt:"阳光下的花园，有蝴蝶",setting,allow_external_generation:true}));
 await waitFor(()=>expect(services.media).toHaveBeenCalledWith("result"));
 if(mode==="image")expect(await screen.findByAltText("生成的图片")).toHaveAttribute("src","blob:generated");
 else await waitFor(()=>expect(view.container.querySelector("video")).toHaveAttribute("src","blob:generated"));
 view.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:generated");
});

it.each([["图片","生成一张图片","想生成的图片","两只小狗在草地上奔跑"],["视频","帮我生成一段视频","想生成的视频","两只小狗在草地上奔跑"]])("asks for content before opening %s settings",async(label,command,inputLabel,description)=>{
 render(<AgentChat/>);
 await waitFor(()=>expect(screen.getByRole("button",{name:"创作类型：聊天"})).not.toBeDisabled());
 fireEvent.click(screen.getByRole("button",{name:"创作类型：聊天"}));fireEvent.click(screen.getByRole("menuitemradio",{name:label}));
 fireEvent.change(screen.getByLabelText(inputLabel),{target:{value:command}});
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 expect(screen.queryByRole("region",{name:`${label}创作引导`})).not.toBeInTheDocument();
 expect(screen.getByRole("status")).toHaveTextContent("想创作什么内容");
 expect(screen.getByLabelText(inputLabel)).toHaveValue("");
 expect(services.generate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"语音输入"}));fireEvent.click(screen.getByRole("button",{name:"同意并开始听写"}));
 act(()=>{recognition.onresult?.({results:[[{transcript:description}]]});recognition.onend?.();});
 fireEvent.click(screen.getByRole("button",{name:"发送"}));
 expect(screen.getByRole("region",{name:`${label}创作引导`})).toHaveTextContent(description);
 expect(services.generate).not.toHaveBeenCalled();
});
