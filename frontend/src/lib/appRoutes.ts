export const HOME_HASH = "#/";
export const WORKSPACE_HASH = "#/workspace";

export function isHomeRoute(hash: string): boolean {
  return hash === "" || hash === HOME_HASH;
}
