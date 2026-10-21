/** Syntactic compatibility only; the backend still checks model permission. */
export function isUniArtVoiceBinding(value: unknown): value is string {
    return typeof value === "string"
        && /^uniart:speech-2\.8-(hd|turbo):[a-z0-9-]+$/.test(value);
}
