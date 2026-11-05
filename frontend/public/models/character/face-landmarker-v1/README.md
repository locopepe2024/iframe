# Face Landmarker runtime

- Model: MediaPipe Face Landmarker float16, version 1, from
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- Model SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- JavaScript and WASM files: copied without modification from
  `@mediapipe/tasks-vision@0.10.8/wasm` (Apache-2.0).

The application runs this model in the browser. Detected points are suggestions
that the user reviews and can correct before fitting the white face model.
