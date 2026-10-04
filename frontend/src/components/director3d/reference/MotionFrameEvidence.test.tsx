import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MotionFrameEvidence, parsePoseProjectionEvidence } from "./MotionFrameEvidence";
afterEach(cleanup);
const evidence = { schema: "motion-frame-projection.v1", source_revision: "sha", source_frame: 12, coordinate_system: "normalized_image_top_left", alignment: "similarity_fit", image_width: 640, image_height: 360, joints: { left_shoulder: [0.4, 0.3] } };
it("binds projection to source frame and revision and validates numeric coordinates", () => {
 expect(parsePoseProjectionEvidence(evidence, "sha", 12).alignment).toBe("similarity_fit");
 expect(() => parsePoseProjectionEvidence(evidence, "other", 12)).toThrow("不匹配");
 expect(() => parsePoseProjectionEvidence(evidence, "sha", 13)).toThrow("不匹配");
 expect(() => parsePoseProjectionEvidence({ ...evidence, joints: { left_shoulder: [NaN, 0] } }, "sha", 12)).toThrow("有限");
});
it("labels skeleton-only evidence and shows source and corrected endpoints", () => {
 render(<MotionFrameEvidence revision="sha" frame={12} original={{ left_shoulder: [0.4, 0.3, 0] }} corrected={{ left_shoulder: [0.5, 0.4, 0] }} />);
 expect(screen.getByText(/尚未选择源帧图片/)).toBeInTheDocument();
 const svg = screen.getByRole("img");
 expect(svg.querySelectorAll("circle")).toHaveLength(2);
 expect(svg.querySelectorAll("circle")[1].getAttribute("cx")).toBe("320");
});
