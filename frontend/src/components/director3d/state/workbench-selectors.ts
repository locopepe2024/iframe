import type { CharacterAuthoringState } from "./workbench-store";

interface CharacterStateSlice {
  characters: Record<string, CharacterAuthoringState>;
}

export function selectCharactersRecord(state: CharacterStateSlice): Record<string, CharacterAuthoringState> {
  return state.characters;
}
