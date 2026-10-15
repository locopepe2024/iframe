# Saved catalog name and gateway diagnostics

Save optional `catalog_name: uniart|greena` beside the existing owner-scoped API
key and gateway URL. This is the catalog identity of that configured gateway,
not a guess based on model ID, hostname, branding, or upstream response model.
Unknown legacy records remain unnamed and use neutral diagnostics until selected.
When a name is saved in key settings, that saved key/URL/name tuple is the active
gateway. Independent explicit provider profiles stay separate and cannot replace
one half of this tuple; explicit provider API calls still use their own profiles.
Unnamed legacy configs retain existing UniArt-profile precedence.
Do not rename credential fields or change workspace identity/encryption semantics.

The legacy gateway config exposes its saved name in runtime metadata. Explicit
profiles expose their provider name. The default model catalog and Agent catalog
normalize using the selected name, endpoint and credential together. Named GreenA
uses the compatible `nsfw/` model namespace; independent explicit provider APIs
continue to enforce their own profile boundary. Preserve legacy unnamed catalog
behavior. Gateway settings save triggers a live catalog refresh.

Agent error text, model validation, empty responses and catalog fetch failures
must use this name (UniArt Catalog / GreenA Catalog); unknown means current catalog.
Capture diagnostic identity at actual model dispatch in request-local context,
including H3; no cross-user globals. Record it on successful chat messages.
No billable provider tests or automatic production source deployment.

Runtime repair completed separately: replace only the exact erroneous media-domain
entry in malysis `/etc/hosts`, keeping a backup. New One DNS now resolves the public
address and downloaded the failing reference image with HTTP 200, image/jpeg,
234547 bytes. SSRF protection remains enabled. This verifies media fetching only,
not successful downstream LLM generation.
