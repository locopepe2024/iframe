import { ACTION_STRUCTURES, type ActionStructure } from "./action-structures";

export type ActionMatch =
  | { status: "no_match"; candidates: []; limitation: string }
  | { status: "matched"; candidates: [ActionStructure]; matchedAlias: string; confidence: number; limitation: string }
  | { status: "ambiguous"; candidates: ActionStructure[]; limitation: string };

export function matchActionIntent(text: string, catalog: readonly ActionStructure[] = ACTION_STRUCTURES): ActionMatch {
  const normalized = text.trim().toLocaleLowerCase();
  const matches = catalog.flatMap((action) => {
    const alias = [action.label, ...action.aliases].find((candidate) => normalized.includes(candidate.toLocaleLowerCase()));
    return alias ? [{ action, alias }] : [];
  });
  if (matches.length === 0) return { status: "no_match", candidates: [], limitation: "未找到可确认的本地动作结构；需要人工指定。" };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches.map(({ action }) => action), limitation: "匹配到多个动作结构；需要人工选择，不能自动应用。" };
  const [{ action, alias }] = matches;
  return { status: "matched", candidates: [action], matchedAlias: alias, confidence: action.confidence, limitation: action.limitations.join(" ") };
}
