import {fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import PhotoOrganizationChoice from "./PhotoOrganizationChoice";

vi.mock("../photos/PhotoFactsEditor",()=>({default:({photoId}:{photoId:string})=><div>手动资料 {photoId}</div>}));
vi.mock("../photos/PhotoContent",()=>({default:({photoId}:{photoId:string})=><div>辅助分析 {photoId}</div>}));
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
