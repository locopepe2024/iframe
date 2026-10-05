import axios from 'axios';
import { API_URL } from './api';
import type { PanoramaQuality } from './imageEditor';

export interface PanoramaAsset {
  id: string;
  path: string;
  title: string;
  sha256: string;
  width: number;
  height: number;
  projection_type: 'equirectangular';
  panorama_quality: PanoramaQuality;
}

export const panoramaAssetApi = {
  async list(limit = 100, offset = 0): Promise<PanoramaAsset[]> {
    const { data } = await axios.get<unknown>(`${API_URL}/playground/panorama-assets`, { params: { limit, offset } });
    if (!Array.isArray(data)) throw new Error('Invalid panorama asset list');
    return data as PanoramaAsset[];
  },
};
