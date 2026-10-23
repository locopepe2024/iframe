# GlobalStore wan3.0-c1 integration evidence

Source: https://docs.globalstore.ai/api-reference/model-center/video-gen/wan3.0-c1
Read: 2026-10-23. Repo-only staging; no external archive/Context Hub promotion.

POST https://saas.globalstore.ai/kyyReactApiServer/v2/model-center/tasks; Bearer authorization; model wan3.0-c1. Required nonempty prompt. reference_images 0–10 URL items, reference_videos 1–1 (marked required), reference_audios 0–5. first_image/last_image each 0–1; example serializes each as a single URL string. duration integer 2–30 default 5. aspect_ratio adaptive,21:9,16:9,4:3,1:1,3:4,9:16 default adaptive. resolution 480P,720P,1080P default 1080P. seed integer. Query task id until completed/failed; download result_url/video_url promptly.

Uncertainty: reference video required conflicts with user-requested text and frame modes. These modes will be exposed by explicit user instruction; acceptance without a video reference needs runtime validation. Document examples do not prove successful generation for every combination.
