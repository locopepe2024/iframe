import { API_URL } from "./api";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function getAssetUrl(path: string | null | undefined): string {
    if (!path) return "";
    // /files is already rooted at output/. Imported Playground assets retain
    // filesystem paths, so remove that root once before building the URL.
    path = path.replace(/^\/?output\//, "");
    const ownedPlaygroundPath = /^\/?users\/([0-9a-f]{24})\/playground\/(.+)$/.exec(path);
    if (ownedPlaygroundPath) {
        return `${API_URL}/studio/owned-playground-media/${ownedPlaygroundPath[1]}/${ownedPlaygroundPath[2].split('/').map(encodeURIComponent).join('/')}`;
    }
    if (path.startsWith("/studio/owned-playground-media/")) return `${API_URL}${path}`;
    // Editor tabs outlive signed display URLs. Same-origin Studio previews
    // use the authenticated owner route, which checks ownership on every GET.
    const studioPath = path.startsWith("/") ? path : path.startsWith(`${API_URL}/`) ? path.slice(API_URL.length) : "";
    const signedStudio = /^\/studio\/media\/([0-9a-f]{24})\/(.+)$/.exec(studioPath.split("?")[0]);
    if (signedStudio) {
        const preview = new URLSearchParams(path.split("?")[1] || "").get("preview");
        return `${API_URL}/studio/owned-media/${signedStudio[1]}/${signedStudio[2]}${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`;
    }
    if (path.startsWith("/studio/owned-media/")) return `${API_URL}${path}`;
    if (path.startsWith("/studio/media/") || path.startsWith("/playground/media/") || path.startsWith("/playground/input-media/")) {
        return `${API_URL}${path}`;
    }
    const ownedStudioPath = /^\/?(?:output\/)?users\/([0-9a-f]{24})\/studio\/(.+)$/.exec(path);
    if (ownedStudioPath) {
        return `${API_URL}/studio/owned-media/${ownedStudioPath[1]}/${ownedStudioPath[2].split('/').map(encodeURIComponent).join('/')}`;
    }
    if (path.startsWith("http") || path.startsWith("blob:")) {
        // Only pass through well-formed http(s)/blob URLs; anything else
        // (e.g. javascript: smuggled behind a weird prefix) is dropped.
        try {
            const protocol = new URL(path).protocol;
            if (protocol === "http:" || protocol === "https:" || protocol === "blob:") {
                // Strip HTML metacharacters as well; well-formed URLs never
                // contain them raw, so this is a no-op for legitimate values.
                return path.replace(/[<>"'`]/g, "");
            }
        } catch {
            // malformed URL — fall through to reject
        }
        return "";
    }

    // Remove leading slash if present to avoid double slashes with API_URL/files/
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    return `${API_URL}/files/${encodeURI(cleanPath)}`;
}

/** Derive a first-frame still only for backend-local owner media. */
export function getVideoPosterUrl(path: string | null | undefined): string {
    const resolved = getAssetUrl(path);
    if (!resolved.startsWith(`${API_URL}/studio/owned-media/`)
        && !resolved.startsWith(`${API_URL}/studio/owned-playground-media/`)) return "";
    return `${resolved.split("?")[0]}?preview=320`;
}

export function getAssetUrlWithTimestamp(path: string | null | undefined, timestamp?: number): string {
    const baseUrl = getAssetUrl(path);
    if (!baseUrl) return "";

    // If URL already has query params, append with & otherwise with ?
    const separator = baseUrl.includes('?') ? '&' : '?';
    return baseUrl + separator + `t=${timestamp || 0}`;
}

export function extractErrorDetail(error: any, fallback = "未知错误"): string {
    const detail = error?.response?.data?.detail || error?.response?.data?.message;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) {
        const messages = detail.map(item => {
            if (typeof item === "string") return item;
            if (item && typeof item.msg === "string") return item.msg;
            try { return JSON.stringify(item); } catch { return String(item); }
        }).filter(Boolean);
        if (messages.length) return messages.join("; ");
    }
    if (detail !== undefined && detail !== null) {
        try { return JSON.stringify(detail); } catch { return String(detail); }
    }
    return error?.message || fallback;
}
