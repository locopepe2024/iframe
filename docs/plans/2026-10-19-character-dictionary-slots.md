# Character dictionary and Skill template slots

## Contract

- `/` opens descriptions and reusable outfits. `@` remains the asset/reference picker.
- Category flow: `/服装` opens ancient robe, ancient skirt and modern clothing configuration panels. `/面容`, `/发型`, `/首饰`, `/装饰`, `/体态`, `/新旧`, `/表情` open their panels. Browsing a category also offers its panels alongside narrower vocabulary categories. Panel choices update one preview, applied only on confirmation. These deterministic panels require no model call.
- Alternative full-template flow: type `/古装 `, choose a complete Prompt template, adjust its dropdown fields before insertion; optional `[变量]` slots can remain for later editing. Generic `古装`/`古风` and `现代`/`女装` searches default to the Prompt-template filter; users can switch to all content or atomic terms. Templates also appear first in mixed results.
- Built-in classical live-action and donghua templates contain editable slots for role, facial features, hair, garment colors/material and footwear. A modern fashion template contains garment, color, material, fit and accessory slots. These are reusable starting texts; they do not call a Skill/model or change generation parameters when selected.
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

## Expanded user vocabulary

- Classified ancient garment shapes, inner/outer garments, skirts/trousers, fabrics (silk, satin, gauze, brocade), patterns, embroidery/weaving, scarves/pibo, hair, makeup, hair jewelry and body ornaments.
- Added eight configurable complete creative references: Han, Wei/Jin, Tang, Song, Ming, xianxia, Qing and wuxia heroine. Rendering style remains selectable independently. Layering is explicit for the xianxia preset rather than a universal “multiple gauze layers” instruction.
- Garment wear and jewelry condition have independent fields. Ordinary images use positive image constraints; no provider support for a separate negative-prompt field is implied.
- Added all 60 user-supplied expression titles in six groups. Expressions are performance, separate from fixed facial identity. Native dropdown groups allow comparison by emotion family. Static insertion uses an observable image state; the supplied original description is preserved as expandable motion reference and is not automatically submitted with the static expression.

## Acceptance

1. Browse rendering style independently from genre/role/outfits and insert one full style description.
2. Change an outfit's color/material/footwear before insertion; preview contains a single consistent choice for each field and no unresolved internal placeholders.
3. Fill modern Skill garment/color slots with short terms; do not append another full prompt.
4. Repeated slots affect only the active occurrence. Preserve surrounding text, selected assets and undo. A removed template must reject a stale replacement.
5. Existing category discovery, platform revision checks, reference picker and keyboard behavior continue to pass.

Validation commands: focused dictionary/editor/playground/character-workbench UI tests, character quick-action unit tests, frontend typecheck and production build. These checks establish frontend behavior, not model compliance with clothing constraints or historical accuracy. No paid image generation is part of this validation.

## Follow-up: sectioned classical configuration

User acceptance: category-labelled Prompt lines; expand ancient men's and women's garments, decoration and jewelry beyond modern example vocabulary. Preserve concrete garment count and wearing relationships.

Implementation boundary: built-in dictionary presets and inline selection panel only. Store section/field definitions in presets and render labelled lines; do not reverse-parse or silently rewrite arbitrary user prose. Existing insertion, slots, references and undo stay intact.

- Offer ancient men's robe and women's skirt directions with distinct garment selector categories; retain existing preset IDs.
- Expand inner garments, men's outer garments, women's upper garments/skirts, footwear, headwear, earrings, necklaces, wrist jewelry and waist pendants. Separate garment pattern/craft/scarf/trim from wearable jewelry.
- Add structured sections for clothing, decoration, jewelry and condition. Optional fields expose “不指定”; omitted choices contribute no clause or empty section. Complete outfits retain coherent default core garments.
- Validate selector separation, optional omission, labelled output, explicit upper-layer constraints, template defaults, UI preview/application and existing reference/slot behavior. Run focused tests, typecheck and production build. Tests do not establish historical accuracy or image-model compliance.

## Follow-up: classical footwear

Add a footwear category and `/鞋履` / `/鞋靴` / `/鞋子` / `/靴子` configuration route. Preserve user-supplied Chinese/English search descriptions for ten footwear directions (and separate straw shoes from cloth footwear). Configure footwear independently of clothing: shape, color, material, craft, motif, toe, sole, ornament and lining. Preview emits a dedicated footwear line.

A selected footwear scheme initializes its own detail defaults; changing scheme clears the previous scheme's field overrides. Generated wording uses neutral shoe shape plus current fields so changing damask to leather does not leave a contradictory damask descriptor. Optional detail fields support omission. Outfit panels and classical complete presets share footwear controls. Deferred slots retain footwear-specific destinations. These are creative references; occupation/dynasty labels are search context, not compatibility guarantees.

Verify bilingual lookup, all supplied directions, style-change defaults, independent garment/shoe fields, optional omission, neutral shape rendering and shared preset integration. No paid generation or historical validation.


## Follow-up: skin tone

Split body skin tone from skin texture. `/肤色` and `/肤质` open a shared optional skin panel, and `[肤色]` resolves only to skin-tone terms, independently of clothing palette, makeup and skin texture. Provide eight tone choices without inferring age, ethnicity, occupation or character traits. Neither field is preselected; omitted fields produce no clause. Existing saved prose and platform skin classifications remain compatible. Validate slash discovery, preview/application, slot isolation and optional rendering. This does not establish model color fidelity under different lighting.


## Follow-up: modern menswear

Add `/男装` and `/现代男装` configuration, a complete modern menswear display template and distinct modern male upper/outer/trouser/footwear categories. Reuse color, material, fit and wear vocabulary. Configure upper, outer and trousers with separate colors, plus independent upper/trouser materials; outerwear and accessories are optional and omitted when unspecified. Keep the existing women's preset IDs and give women's garment slots their own category. These categories describe garment search destinations, not restrictions on who may wear them. Validate male/female slot separation, upper/lower output, optional outerwear and complete template preview/application.


## Follow-up: unified AI action, workbench hierarchy and height

Acceptance: one optional “AI 完善” action reuses the existing reviewed design request; no second polish service or automatic model call. It organizes the current design and proposes missing details while preserving explicit constraints and surfacing conflicting inputs. Keep the role description read-only and collapsible, labelled as description rather than claiming verbatim script provenance. Keep one asset-type tab bar without step numbers, hide the duplicate active-panel title, and label static/motion modes consistently.

Height is independent of body build and posture: add a dictionary category/panel, `[身高]` destination, and an optional identity `height` feature. Support descriptive presets and user-entered centimetres in the identity editor; do not infer exact height from a single image. Extend AI output normalization and revision validation together so height survives draft review, save and reload. Existing drafts remain valid. Verify dictionary preview/slots, workbench hierarchy, AI input review, height projection, backend output and persisted revisions; typecheck and build. No image-generation outcome or automatic conflict detection is implied by prompt instructions alone.


## Bug fix: generated variants with an empty main viewer

Reproduced: CharacterWorkbench constructs an authenticated preview locator from the image container (`ImageAsset`) rather than its owning character. Image containers have variants and a selected ID, but no character ID; the emitted locator omits assetId. The preview endpoint requires a visible owner asset and exact variant. Pass the owning character ID and project/series scope explicitly to all three image panels. Keep authenticated previews; do not replace a failed authorized request with an unrelated raw image fallback.

VariantSelector must distinguish no variants, preview loading and preview failure, with an explicit retry. A variant pool without a stored selection may preview its first member without persisting a selection; a stale explicit selected ID must remain an unavailable selection rather than switching to legacy assets. Verify locator ownership, asynchronous loading/failure/retry, generation-result refresh, and existing selection/deletion behavior. This code reproduction does not establish the exact live request until runtime inspection.
