# Map boundary data

`ncr-cities.geojson` — the 17 local government units of Metro Manila (NCR).

- Source: Philippine Statistics Authority PSGC boundaries (as of 31 Dec 2023),
  via [faeldon/philippines-json-maps](https://github.com/faeldon/philippines-json-maps)
  (`2023/geojson/provdists/hires`, mapshaper-simplified to 10%). MIT License,
  Copyright (c) James Faeldon.
- Merged into one FeatureCollection; properties reduced to `id` (PSGC code) and `name`.

The network drawn on top of these boundaries is synthetic.
