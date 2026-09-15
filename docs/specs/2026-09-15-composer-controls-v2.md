# Composer Controls V2

Scope: remove duplicate media selection entry points, move the prompt count to
the parameter bar, expose image ratio and GPT image quality in the active composer.

The method button opens only CreationMethodSelector. A single plus button in the
prompt area opens MediaInput for upload/library selection. Remove the old prompt
toolbar row. Preserve selected media, draft persistence and mode selection.

Image ratio is compiled into explicit pixel `size`, keeping 1k/2k/4k resolution
separate as a UI choice. GPT quality uses low/medium/high. Current UniArt model
listing declares resolution but omits ratio/quality. Gateway source declares
quality, and the existing LumenX adapter forwards size/quality. Unknown ratio
fields are not reliably serialized, so do not simply add an aspect_ratio field.
Support for the exact dimensions on each live route remains unverified until a
real generation. Do not claim output-level validation from request tests alone.

Checks: composer interactions for image/video methods and one add button; count
placement; ratio/quality selection persistence; adapter request tests for explicit
dimensions and quality; typecheck and production build. Preserve rollback images
when deploying. No unrelated catalog defaults, provider routing or asset ID
migration are included.
