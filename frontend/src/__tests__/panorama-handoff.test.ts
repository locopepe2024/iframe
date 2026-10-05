import { expect, it } from "vitest";
import { eligiblePanoramaHandoff, stagePanoramaHandoff, takePanoramaHandoff } from "@/components/director3d/state/panorama-handoff";

const panorama = { id: "pano", path: "/playground/input-media/pano.png", title: "Room", source_reference: "", source_sha256: "",
  sha256: "a".repeat(64), width: 800, height: 400, projection_type: "equirectangular" as const,
  panorama_quality: { status: "pass" as const, blocking_codes: [] } };

it("passes only a verified saved panorama to the director and consumes it once", () => {
  const values = new Map<string, string>();
  const storage = { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } };
  expect(stagePanoramaHandoff(panorama, storage)).toBe(true);
  expect(takePanoramaHandoff(storage)).toEqual({ inputId: panorama.path, checksum: panorama.sha256 });
  expect(takePanoramaHandoff(storage)).toBeNull();
});

it("rejects bad geometry, quality or owner scope before navigation", () => {
  expect(eligiblePanoramaHandoff({ ...panorama, width: 801 })).toBe(false);
  expect(eligiblePanoramaHandoff({ ...panorama, panorama_quality: { status: "review", blocking_codes: ["black_pole_gap"] } })).toBe(false);
  expect(eligiblePanoramaHandoff({ ...panorama, path: "https://other.example/pano.png" })).toBe(false);
});
