import { expect, it } from "vitest";

import { ACTION_STRUCTURES, validateActionStructure } from "@/components/director3d/action/action-structures";
import { matchActionIntent } from "@/components/director3d/action/action-intent";

it("validates the illustrative five-phase action and its catalog identity", () => {
  const action = ACTION_STRUCTURES[0];
  expect(validateActionStructure(action)).toEqual([]);
  expect(action.phases.map((phase) => phase.phaseId)).toEqual(["prepare", "lift", "probe", "contact-recoil", "recover"]);
  expect(action.intent.derivation).toBe("illustrative");
  expect(validateActionStructure({ ...action, contacts: [{ ...action.contacts[0], sourceJointId: "missing" }] })).toContain("identity");
  expect(validateActionStructure({ ...action, contacts: [{ ...action.contacts[0], sourceJointId: "missing" }] })).toContain("contact:contact-recoil");
  expect(validateActionStructure({ ...action, phases: action.phases.map((phase, index) => index === 1 ? { ...phase, role: "invalid" as typeof phase.role } : phase) })).toContain("phaseContract:lift");
});

it("matches 鹤形拳 without treating unknown or ambiguous names as a proposal", () => {
  const matched = matchActionIntent("让 A 做一段鹤形拳，15 秒");
  expect(matched.status).toBe("matched");
  if (matched.status !== "matched") return;
  expect(matched.candidates[0].actionId).toBe("martial.hexingquan.blocking.v1");
  expect(matched.limitation).toContain("示意");
  expect(matchActionIntent("打一段不明动作").status).toBe("no_match");
  expect(matchActionIntent("鹤形拳", [ACTION_STRUCTURES[0], { ...ACTION_STRUCTURES[0], actionId: "other" }]).status).toBe("ambiguous");
});
