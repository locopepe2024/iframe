import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { API_URL, api } from "../lib/api";

vi.mock("axios", () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}));

describe("Assembly render client", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(axios.post).mockResolvedValue({ data: { url: "video/assembly.mp4" } });
    });

    it.each([
        ["project", "project-1", "projects"],
        ["series", "series-1", "series"],
    ] as const)("posts the %s render to its explicit endpoint", async (scope, id, base) => {
        await expect(api.renderAssemblyPlan(scope, id)).resolves.toEqual({
            url: "video/assembly.mp4",
        });
        expect(axios.post).toHaveBeenCalledWith(
            `${API_URL}/${base}/${id}/assembly-plan/render`,
        );
    });
});
