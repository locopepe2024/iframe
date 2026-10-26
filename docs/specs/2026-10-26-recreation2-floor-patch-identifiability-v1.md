# Floor-near patch identifiability probe

Read-only source video, same hash and PTS as prior work. Preselect eight image patches away from subject/reflection: half-resolution x120/220/480/580 at y337/352. These are floor-near image regions, not certified coplanar points. Sample source17/23/29/37 and43/47/51/55, anchored separately at17/43. No inferred physical floor or calibrated camera.

Use fixed-reference NCC at two template sizes; retain strongest spatially separated alternative (>4 half pixels), forward/backward matching, boundary hits and two-size disagreement. Provisional matching gate set before execution: NCC>=0.85, peak gap>=0.02, cycle error<=2 full pixels, template disagreement<=4 full pixels, no boundary. This is an engineering identifiability gate, not calibrated confidence.

Only if >=4 distinct accepted points span both y rows, fit similarity and affine; record singular values, leave-one-out prediction range at visible shoe center and residuals on omitted points. No training-residual-only acceptance. Repeated texture/parallel floor lines can fail horizontal localization despite high NCC. Do not create world locking/IK targets if this gate fails. Outputs: JSON plus annotated source-region artifact; no production changes.
