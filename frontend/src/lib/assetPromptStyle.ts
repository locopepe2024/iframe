/** Copy an optional style into editable prompt fields before submission. */
export function includeVisibleStyle(prompt: string, style: string): string {
    const addition = style.trim();
    if (!addition || prompt.includes(addition)) return prompt;
    return prompt.trim() ? `${prompt.trim()}\n\n${addition}` : addition;
}
