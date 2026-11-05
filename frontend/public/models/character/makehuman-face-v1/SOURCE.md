# MakeHuman Face Base

- Upstream: https://github.com/makehumancommunity/makehuman
- Upstream commit: `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`
- Source asset: `makehuman/data/3dobjs/base.obj`
- Source license: CC0 1.0 Universal. The upstream OBJ header and `makehuman/license.txt` explicitly cover the base mesh. No MakeHuman application code is included.
- Derived asset: `head.json`, generated with `node scripts/build_makehuman_face.mjs base.obj head.json`.
- Extraction: body faces whose vertices have source Y >= 6.2, normalized to the local head preview coordinates. Original vertex IDs are retained for future MakeHuman target deltas.
