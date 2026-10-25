import {fireEvent,render,screen} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import CompanionIdentitySettings,{companionIdentityKey,defaultCompanionIdentity,readCompanionIdentity} from "./CompanionIdentitySettings";
beforeEach(()=>localStorage.clear());
it("saves assistant name, avatar and voice as one identity",()=>{
 const change=vi.fn();render(<CompanionIdentitySettings onChange={change}/>);
 fireEvent.change(screen.getByLabelText("名字"),{target:{value:"小暖"}});
 fireEvent.click(screen.getByRole("button",{name:"选择形象 🐻"}));
 fireEvent.change(screen.getByLabelText("音色"),{target:{value:"longanyang_v3.6"}});
 expect(readCompanionIdentity()).toEqual({name:"小暖",avatar:"🐻",voice:"longanyang_v3.6"});expect(change).toHaveBeenCalled();expect(localStorage.getItem(companionIdentityKey)).toContain("小暖");
});
it("uses safe defaults when browser storage is malformed",()=>{localStorage.setItem(companionIdentityKey,"{");expect(readCompanionIdentity()).toEqual(defaultCompanionIdentity);});
