# Character dictionary and Skill template slots

## Contract

- `/` opens descriptions and reusable outfits. `@` remains the asset/reference picker.
- Rendering style, era/genre, role and clothing are separate categories. A rendering description does not choose identity, garments or a scene.
- Skill design-route identifiers remain supported in the design sidebar; they are not inserted as prompt descriptions by the inline dictionary.
- A Skill can output plain-text `[变量]` slots. Clicking inside a slot, or selecting the whole bracketed slot, opens its dictionary destination. Confirmation replaces only that occurrence, including brackets. Other text, unresolved slots and reference tokens remain intact; replacement supports undo.
- Known slot labels route by meaning: color, material, fit, collar, sleeve, footwear, inner/outer garments, bottoms, accessories, garment type and rendering style. Unknown labels open category browsing and remain manually editable. No generation is triggered by browsing or filling.
- New atomic terms carry a short slot value and a full descriptive sentence. Filling `[颜色]` inserts `靛蓝色`; ordinary `/` insertion uses the descriptive sentence.
- Reusable outfits define inner garment, outer garment, lower garment and footwear. Selectors update the complete description before insertion. The stated two layers refer to the upper body, not the total number of garments.
- Existing arbitrary prose is not parsed or automatically rewritten when another term is inserted. Editable text and manual conflict resolution are preserved. Prompt aspect text does not change the generation size control.

## Scope and content

Frontend paths: `characterDictionaryCategories.ts`, `characterDictionaryPresets.ts`, `CharacterPromptDictionary.tsx`, `ReferencePromptEditor.tsx`, `PromptInput.tsx` and their focused tests. No provider, model catalog, generation route, billing or paid generation changes.

Initial reusable outfits are creative costume descriptions, not historically verified dynasty reconstructions. Era words express context rather than proven garment morphology. Additional supplied content should be classified before ingestion; rendering styles must not silently add garments or identity.

Modern fashion field structure was informed by GPTImg2.art's [ai-nvzhuang-prompt-cookbook](https://github.com/gpt-img-2/ai-nvzhuang-prompt-cookbook), inspected through GitHub API at commit `a90544355c2caa1bad9c07996fe0b45220063118`. Its README declares CC BY 4.0 and requests attribution to GPTImg2.art. The repository metadata reports `NOASSERTION`; the explicit README statement is the observed licensing evidence. This change writes concise iFrame descriptions and adds field categories; it does not import the source's full prompts, images, or external branded style references. Source reference and attribution are retained here.

## Acceptance

1. Browse rendering style independently from genre/role/outfits and insert one full style description.
2. Change an outfit's color/material/footwear before insertion; preview contains a single consistent choice for each field and no unresolved internal placeholders.
3. Fill modern Skill garment/color slots with short terms; do not append another full prompt.
4. Repeated slots affect only the active occurrence. Preserve surrounding text, selected assets and undo. A removed template must reject a stale replacement.
5. Existing category discovery, platform revision checks, reference picker and keyboard behavior continue to pass.

Validation commands: focused dictionary/editor/playground/character-workbench UI tests, character quick-action unit tests, frontend typecheck and production build. These checks establish frontend behavior, not model compliance with clothing constraints or historical accuracy. No paid image generation is part of this validation.
