import {fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import PhotoOrganizationChoice from "./PhotoOrganizationChoice";

vi.mock("../photos/PhotoFactsEditor",()=>({default:({photoId,onSaved}:{photoId:string;onSaved:()=>void})=><div>手动资料 {photoId}<button onClick={onSaved}>模拟保存</button></div>}));
vi.mock("../photos/PhotoContent",()=>({default:({photoId,onSaved}:{photoId:string;onSaved:()=>void})=><div>辅助分析 {photoId}<button onClick={onSaved}>模拟保存</button></div>}));
afterEach(()=>vi.restoreAllMocks());

it("allows cancelling departure before discarding the editor",()=>{
  const confirm = vi.spyOn(window,"confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(<PhotoOrganizationChoice photoId="p4" name="照片"/>);
  fireEvent.click(screen.getByRole("button",{name:"自己填写"}));
  fireEvent.click(screen.getByRole("button",{name:"返回选择整理方式"}));
  expect(screen.getByText("手动资料 p4")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"返回选择整理方式"}));
  expect(screen.getByRole("button",{name:"自己填写"})).toBeInTheDocument();
  expect(confirm).toHaveBeenCalledTimes(2);
});

it("waits for a choice and opens only the manual editor",()=>{
  render(<PhotoOrganizationChoice photoId="p1" name="旧照片"/>);
  expect(screen.queryByText(/手动资料/)).not.toBeInTheDocument();
  expect(screen.queryByText(/辅助分析/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"自己填写"}));
  expect(screen.getByText("手动资料 p1")).toBeInTheDocument();
  expect(screen.queryByText(/辅助分析/)).not.toBeInTheDocument();
});

it("opens the existing assisted analysis flow only on request",()=>{
  render(<PhotoOrganizationChoice photoId="p2" name="合影"/>);
  fireEvent.click(screen.getByRole("button",{name:"小安帮我整理"}));
  expect(screen.getByText("辅助分析 p2")).toBeInTheDocument();
  expect(screen.queryByText(/手动资料/)).not.toBeInTheDocument();
});

it("defers without opening either editor",()=>{
  render(<PhotoOrganizationChoice photoId="p3" name="风景"/>);
  fireEvent.click(screen.getByRole("button",{name:"以后再说"}));
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});

it.each(['自己填写','小安帮我整理'])("closes the %s editor only after its successful save",choice=>{
  render(<PhotoOrganizationChoice photoId="p5" name="照片"/>);
  fireEvent.click(screen.getByRole("button",{name:choice}));
  expect(screen.getAllByRole("button",{name:"返回选择整理方式"})).toHaveLength(1);
  expect(screen.queryByRole("button",{name:"收起整理"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"模拟保存"}));
  expect(screen.getByRole("status")).toHaveTextContent("照片资料已保存。");
  expect(screen.queryByRole("button",{name:"模拟保存"})).not.toBeInTheDocument();
});
