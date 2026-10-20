import axios from "axios";
import { API_URL } from "./api";
import { parseDesignProposal } from "@/components/director3d/design/design-proposal";

export interface DesignTurn { role: "user" | "assistant"; content: string }
export const directorDesignApi = {
  async propose(request: { prompt: string; baseRevision: string; context: string; history: DesignTurn[] }, signal?: AbortSignal) {
    const response = await axios.post<unknown>(`${API_URL}/director3d/design-proposals`, request, { timeout: 60000, signal });
    return parseDesignProposal(response.data);
  },
};
