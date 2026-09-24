import { ACTION_STRUCTURES, actionStructureChecksum, validateActionStructure } from "./action-structures";
import { matchActionIntent } from "./action-intent";
import type { WorkbenchState } from "../state/workbench-store";

export interface DirectorActionPlan {
  planId: string;
  sceneRevision: string;
  actionId: string;
  catalogVersion: string;
  actionChecksum: string;
  characterId: string;
  opponentId: string | null;
  startSeconds: number;
  durationSeconds: number;
  includeContact: boolean;
  requiresApproval: true;
  limitations: string[];
}

export type DirectorPlanResult = { ok: true; plan: DirectorActionPlan } | { ok: false; reasons: string[] };

function sceneRevision(state: Pick<WorkbenchState, "dialogueTimeline" | "characters">): string {
  const source = JSON.stringify({ timeline: state.dialogueTimeline, characters: Object.fromEntries(Object.entries(state.characters).map(([id, character]) => [id, { locked: character.locked, actorMappingId: character.actorMappingId }])) });
  let hash = 2166136261;
  for (const char of source) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `scene-fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createDirectorActionPlan(state: WorkbenchState, request: { text: string; characterId: string; opponentId?: string | null; startSeconds: number; durationSeconds?: number; includeContact?: boolean }): DirectorPlanResult {
  const match = matchActionIntent(request.text);
  if (match.status !== "matched") return { ok: false, reasons: [match.limitation] };
  const action = match.candidates[0];
  const durationSeconds = request.durationSeconds ?? action.defaultDurationSeconds;
  const opponentId = request.opponentId ?? null;
  const reasons: string[] = [];
  if (validateActionStructure(action).length) reasons.push("action_invalid");
  if (!state.characters[request.characterId]) reasons.push("character_missing");
  if (state.characters[request.characterId]?.locked) reasons.push("character_locked");
  if (opponentId && (!state.characters[opponentId] || opponentId === request.characterId)) reasons.push("opponent_invalid");
  if (!Number.isFinite(request.startSeconds) || request.startSeconds < 0) reasons.push("start_invalid");
  if (!Number.isFinite(durationSeconds) || durationSeconds < action.durationRangeSeconds[0] || durationSeconds > action.durationRangeSeconds[1]) reasons.push("duration_invalid");
  if (request.startSeconds + durationSeconds > 3600) reasons.push("end_invalid");
  if (reasons.length) return { ok: false, reasons };
  return { ok: true, plan: {
    planId: `director-plan-${action.actionId}-${request.characterId}-${Math.round(request.startSeconds * 1000)}`,
    sceneRevision: sceneRevision(state), actionId: action.actionId, catalogVersion: action.catalogVersion,
    actionChecksum: actionStructureChecksum(action), characterId: request.characterId, opponentId,
    startSeconds: request.startSeconds, durationSeconds, includeContact: Boolean(request.includeContact && opponentId),
    requiresApproval: true, limitations: [match.limitation, ...action.limitations],
  } };
}

export function validateDirectorActionPlan(state: WorkbenchState, plan: DirectorActionPlan): string[] {
  const currentAction = ACTION_STRUCTURES.find((action) => action.actionId === plan.actionId);
  const reasons: string[] = [];
  if (!currentAction || currentAction.catalogVersion !== plan.catalogVersion || actionStructureChecksum(currentAction) !== plan.actionChecksum) reasons.push("action_changed");
  if (sceneRevision(state) !== plan.sceneRevision) reasons.push("scene_changed");
  if (!state.characters[plan.characterId]) reasons.push("character_missing");
  if (state.characters[plan.characterId]?.locked) reasons.push("character_locked");
  if (plan.opponentId && (!state.characters[plan.opponentId] || plan.opponentId === plan.characterId)) reasons.push("opponent_invalid");
  if (!plan.requiresApproval) reasons.push("approval_required");
  return reasons;
}
