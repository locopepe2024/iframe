import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/api", () => ({ API_URL: "https://iframe.example" }));
import { getAssetUrl } from "@/lib/utils";

const owner = "0123456789abcdef01234567";
describe("Studio editor media references", () => {
    it.each(["", "/", "output/", "/output/"])("maps imported locators with prefix %s to owner-authenticated originals", (prefix) => {
        const relative = `users/${owner}/playground/images/样片 1.jpg`;
        expect(getAssetUrl(prefix + relative)).toBe(`https://iframe.example/studio/owned-playground-media/${owner}/images/${encodeURIComponent("样片 1.jpg")}`);
    });
    it("uses authenticated routes for stale relative and same-backend signed URLs", () => {
        const path = `/studio/media/${owner}/uploads/a.jpg?expires=1&signature=old`;
        const expected = `https://iframe.example/studio/owned-media/${owner}/uploads/a.jpg`;
        expect(getAssetUrl(path)).toBe(expected);
        expect(getAssetUrl(`https://iframe.example${path}`)).toBe(expected);
        expect(getAssetUrl(`/studio/owned-media/${owner}/uploads/a.jpg`)).toBe(expected);
        expect(getAssetUrl(path + "&preview=512")).toBe(expected + "?preview=512");
    });
    it("keeps external URLs and Playground signed routes unchanged", () => {
        const external = `https://other.example/studio/media/${owner}/uploads/a.jpg?expires=1&signature=old`;
        expect(getAssetUrl(external)).toBe(external);
        expect(getAssetUrl("https://provider.example/output/image.jpg")).toBe("https://provider.example/output/image.jpg");
        expect(getAssetUrl("/playground/media/g/o?expires=1&signature=s")).toBe("https://iframe.example/playground/media/g/o?expires=1&signature=s");
    });
    it("keeps owned routes rooted once and does not double-prefix Studio filesystem paths", () => {
        const route = `/studio/owned-playground-media/${owner}/uploads/a.jpg`;
        expect(getAssetUrl(route)).toBe(`https://iframe.example${route}`);
        expect(getAssetUrl(`output/users/${owner}/studio/uploads/a.jpg`)).toBe(`https://iframe.example/studio/owned-media/${owner}/uploads/a.jpg`);
    });
});
