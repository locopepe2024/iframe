# Character review option contract

Production diagnostic `375620f65a77` identifies a string-valued `review_items[0].suggested_route` outside the accepted options. Raw model output was not retained, so its exact value is unknown. The prompt names the optional fields and includes route documentation, but does not provide their output enum or explain how to omit an unchanged option.

Use one immutable set of route and age-stage IDs for request validation, response validation and the review-item JSON Schema embedded in the previewed model input. Specify exact IDs, no translated labels or composite values, and omission or null for unchanged optional choices. Keep strict rejection of empty, unknown and malformed values; do not infer aliases, discard an invalid review or automatically retry generation. Preserve preview-token checks and explicit user application of suggestions.

Verify that the preview contains the same option enums used by response validation, that all supported options survive into editable suggestion choices, that omitted/null choices preserve the current selection, and that empty/unknown/non-string choices still fail without logging private design content. Run character-design and Agent regression tests before publishing and deploy only after active GreenA tasks finish.
