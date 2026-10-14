import { expect, it, vi } from "vitest";
import { createRenderRequestId } from "../lib/renderRequestId";

it("creates distinct UUID request IDs when randomUUID is unavailable", () => {
    let next = 0;
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
        bytes.forEach((_, index) => { bytes[index] = next++ & 0xff; });
        return bytes;
    });
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues });
    try {
        const first = createRenderRequestId();
        const second = createRenderRequestId();
        expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(second).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(second).not.toBe(first);
        expect(getRandomValues).toHaveBeenCalledTimes(2);
    } finally {
        vi.stubGlobal("crypto", originalCrypto);
    }
});
