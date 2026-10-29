import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ChoiceCard from "./ChoiceCard";
import type { ChoiceCard as Card } from "@/lib/companionApi";

const card:Card={protocol:"companion.ui.v1",component:"choice_card",card_id:"task:1:source",task:{id:"task",revision:1},status:"active",spoken_text:"选一张照片",props:{title:"想修改哪张照片？",options:[{id:"upload",label:"上传照片",action:"media.open_upload"},{id:"album",label:"从相册选择",action:"media.open_album"},{id:"back",label:"返回聊天",action:"media.pause"}]}};

it("renders registered choices and retries the exact operation after uncertainty",async()=>{
 const choose=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
 render(<ChoiceCard card={card} disabled={false} onChoose={choose}/>);
 fireEvent.click(screen.getByRole("button",{name:"从相册选择"}));
 await screen.findByRole("button",{name:"重试这次选择"});
 expect(screen.queryByRole("button",{name:"上传照片"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"重试这次选择"}));
 await waitFor(()=>expect(choose).toHaveBeenCalledTimes(2));
 expect(choose.mock.calls[0][0]).toEqual(choose.mock.calls[1][0]);
 expect(choose.mock.calls[0][0]).toEqual(expect.objectContaining({card_id:card.card_id,option_id:"album"}));
});

it("does not execute navigation on render and respects disabled state",()=>{
 const choose=vi.fn();
 render(<ChoiceCard card={card} disabled={true} onChoose={choose}/>);
 expect(screen.getByRole("button",{name:"上传照片"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"上传照片"}));
 expect(choose).not.toHaveBeenCalled();
});

it("rejects unknown actions instead of rendering executable controls",()=>{
 const choose=vi.fn();
 const invalid={...card,props:{...card.props,options:[{id:"upload",label:"执行",action:"arbitrary.execute"}]}} as unknown as Card;
 render(<ChoiceCard card={invalid} disabled={false} onChoose={choose}/>);
 expect(screen.getByRole("alert")).toBeInTheDocument();
 expect(screen.queryByRole("button")).not.toBeInTheDocument();
 expect(choose).not.toHaveBeenCalled();
});
