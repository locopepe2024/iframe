/** Syntactic compatibility only; the backend still checks model permission. */
export function isUniArtVoiceBinding(value: unknown): value is string {
    return typeof value === "string"
        && /^uniart:speech-2\.8-(hd|turbo):[A-Za-z0-9_ ()（）-]{1,128}$/.test(value);
}
