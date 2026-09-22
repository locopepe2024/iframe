# iFrame Studio brand migration

Target: iFrame Studio V0.1.0, repository locopepe2024/iframe, source root codex/iframe.
Use supplied logo_1.png for browser, About, and desktop icons. Keep original upstream license attribution.
Update checking is inactive and performs no network requests.
Default user data/logs become ~/.iframe and ~/.iframe/logs; existing environment overrides remain compatible. On first access copy legacy ~/.lumen-x data into the new directory without removing the original; never overwrite an existing destination.
Legacy browser storage/cookies and LUMENX_* provider/config variables remain readable so rebranding does not invalidate identities or credentials. They are compatibility identifiers rather than display branding.
Rename product-specific source/build paths and update references. Preserve historical design and licensed skill provenance.
Verification: brand/update UI tests, data-directory migration tests, backend regression, typecheck, production build, asset size checks, source-path reference scan.
Deployment is separate from creating the new repository; do not move live database/output directories during source publication.
