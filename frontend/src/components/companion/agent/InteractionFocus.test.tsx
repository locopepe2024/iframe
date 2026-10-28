import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createFocusSync, createInteractionFocus, InteractionFocusContext, useInteractionFocus, type InteractionFocus } from "./InteractionFocus";
const fetch=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({API_URL:"",authenticatedFetch:fetch}));
const diary:InteractionFocus={kind:"diary",object_id:"2026-10-28",phase:"editing",draft:"今天喝茶"};
beforeEach(()=>{vi.resetAllMocks();});
function Editor({value}:{value:InteractionFocus|null}){useInteractionFocus(value);return null;}
it("tracks the latest editor draft and clears focus on close",()=>{
  const focus=createInteractionFocus();
  const view=render(<InteractionFocusContext.Provider value={focus}><Editor value={diary}/></InteractionFocusContext.Provider>);
  expect(focus.current()).toEqual(diary);
  view.rerender(<InteractionFocusContext.Provider value={focus}><Editor value={{...diary,phase:"listening",draft:"今天和女儿喝茶"}}/></InteractionFocusContext.Provider>);
  expect(focus.current().draft).toBe("今天和女儿喝茶");
  expect(focus.current().phase).toBe("listening");
  view.unmount();expect(focus.current().kind).toBe("chat");
});
it("does not clear a newer editor when an earlier editor unmounts",()=>{
  const focus=createInteractionFocus();const old=Symbol(),next=Symbol();
  act(()=>{focus.register(old,diary);focus.register(next,{kind:"photo",object_id:"p",phase:"editing",draft:"树下"});focus.remove(old);});
  expect(focus.current().object_id).toBe("p");
});
it("replays exactly the same focus update after a lost response",async()=>{
  fetch.mockResolvedValueOnce({ok:true,json:async()=>({revision:4})}).mockRejectedValueOnce(new Error("lost"))
    .mockResolvedValueOnce({ok:true,json:async()=>({revision:5})});
  const sync=createFocusSync();await expect(sync("session","turn",diary)).rejects.toThrow("lost");
  await sync("session","turn",{...diary,draft:"later edits"});
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[1]).toEqual(fetch.mock.calls[2]);
  expect(JSON.parse(fetch.mock.calls[2][1].body).focus.draft).toBe(diary.draft);
});
it("surfaces a conflict without overwriting another client's focus",async()=>{
  fetch.mockResolvedValueOnce({ok:true,json:async()=>({revision:4})}).mockResolvedValueOnce({ok:false,status:409});
  await expect(createFocusSync()("session","turn",diary)).rejects.toThrow("别处变化");
  expect(fetch).toHaveBeenCalledTimes(2);
});
