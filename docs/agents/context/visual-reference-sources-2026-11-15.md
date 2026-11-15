# Existing visual reference sources

Recovered from the user's earlier source requests on 2026-11-15. This register
records prior requests and local integration evidence; it is not a fresh crawl
or a claim that every source has been imported.

## User's eight-source register, 2026-10-19

| Source | Original URL | Requested use |
| --- | --- | --- |
| Shot.Cafe | `http://shot.cafe` | Shot references |
| Film Grab | `http://film-grab.com` | Composition and color references |
| Eyecannndy | `http://eyecannndy.com` | Names of visual techniques |
| Melies | `http://melies.co/cinematic-techniques` | Technique explanations and prompt references |
| AI Camera Movements | `http://aicameramovements.com` | Camera movement descriptions |
| Grok Film | `http://grokfilm.app` | Lighting and editing references |
| YouMind | `https://youmind.com/` | Skills and workflows |
| Motuart | `https://motuart.com` | Image design references |

The existing design already records these sources:
`docs/specs/2026-10-19-platform-reference-discovery-in-design-v1.md`.
Registration does not establish imported content, model-input media rights, or
runtime availability. In particular, Film Grab is already a color-reference
source in the user's plan; this change does not replace that plan with eight
new color looks.

## Later source priority, 2026-10-26 to 2026-10-27

The user requested Screenweaver first, then corresponding Open AI Canvas
styles, motion, effects and lighting. The original request listed 15 color/image
styles and 20 genre looks among the Screenweaver categories. These are counts
from that request, not reverified current website counts.

- `https://www.screenweaver.ai/zh/film-techniques#editing`
- `https://www.screenweaver.ai/zh/film-techniques/time-motion/stutter-motion`
- `https://www.screenweaver.ai/zh/film-techniques/camera-movement/dolly-in`

The request also distinguished detailed technique analysis from a flat category
list and suggested the more detailed explanations for an academy/blog surface.
This additive catalog change does not implement that larger source pipeline.

## Existing bundled text catalog and this increment

`frontend/src/lib/openAiCanvasPrompts.json` contains 45 visual styles, 33 motion
templates and 9 multi-view/projection templates, with pinned source revision
`86ebb6c5345287c645e857a8f550901bb6fd4bd8`. These remain in the same discovery UI.

The eight new neutral color descriptions are a separate, deduplicated increment
based on the categories in reference revision
`4a37fa6593a17a77ad8c951492d560e829a0108a`. They are independently written iFrame
descriptions, with reference anchors for discovery, not exact film emulations.
Their provenance is kept separate from Open AI Canvas. No source photographs,
videos, erotic examples or upstream agent instructions are imported.

The broader source list remains the foundation for subsequent coverage review.
Named-anchor absence alone does not prove that a visual effect is missing.

Follow-up: `docs/agents/context/source-import-status-2026-11-15.md` records the
nine-source status audit, the recovered 263-link Screenweaver inventory, separate
IYIShow import evidence and the 15-direction color coverage comparison. Three
independently authored color-technique entries extend the existing discovery UI;
they do not turn the registered sites into imported catalogs.
