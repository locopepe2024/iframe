# Target patch projection versus source 2D sole proxy

Use media Blender 4.5.9 pinned rig, original raw_root_yaw bundle, and source heel/foot-index midpoint report. At source frames 1/17/23/29/41/55 project ankle head, foot head, toe head and fixed sole patch into the 640x360 target camera. Scale source midpoint from 1394x792 to 640x360. Keep semantic side labels from existing source evidence. This is a 2D proxy comparison, not metric contact truth.

Record all four pixel errors, input visibility, exact hashes, and whether a sidewise translation calibrated at support entry remains stable. Do not fit rotations/focal/depth or alter bundle. Acceptance is reproducible projection and explicit proxy limitations, not a threshold for H3.
