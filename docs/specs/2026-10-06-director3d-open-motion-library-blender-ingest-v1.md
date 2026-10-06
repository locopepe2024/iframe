# Director 3D open motion library Blender ingest v1

## Scope

本阶段把外部动作资源作为 Blender 媒体主机输入，先完成来源登记、许可证状态、BVH 导入探针和目标白模重定向前的 manifest。浏览器仍只接受 `iframe.director3d.local-animation.v1` JSON，不直接解析 BVH、FBX 或 GLB。

## Boundaries

- 动作库 catalog 只登记资源元数据，不自动下载第三方文件。
- `licenseStatus` 不是法律结论；未人工确认的资源必须保持 `needs_verification`，不能进入生产库。
- Blender ingest 只证明文件可读取、动作和骨架可见，并输出骨架摘要；不证明目标 rig 已完成重定向。
- 目标重定向必须使用明确的 bone map、rest pose evidence 和 rig SHA-256，随后才能生成 `director-full-motion-bundle.v1`。

## Catalog contract

```json
{
  "schema": "director3d-motion-library.catalog.v1",
  "entries": [{
    "motionId": "string",
    "title": "string",
    "format": "bvh | fbx | glb",
    "source": { "kind": "local | external", "label": "string", "url": null },
    "licenseId": "string",
    "licenseStatus": "verified | needs_verification | restricted",
    "actionTags": ["martial_arts"],
    "fps": 24,
    "skeletonProfile": "string",
    "retargetPlugin": { "id": "none | expy_kit | rokoko_studio_live | native_blender", "version": null },
    "retargetStatus": "unmapped | mapped | validated"
  }]
}
```

Catalog entries with `url` are references only. A local source must be copied into the media host intake directory and hashed before ingest.

## Blender ingest

```text
catalog entry + local BVH
  -> import_bvh_motion_library.py
  -> motion-library-ingest.v1.json
  -> bone map / rest evidence review
  -> retarget solver
  -> director-full-motion-bundle.v1
```

The ingest manifest records Blender version, input SHA-256, imported armature names, action names, frame range, FPS, and bone names. It must include warnings when no armature or action is found.

### Retarget plugin policy

- `expy_kit` is the open-source candidate for Mixamo/Rigify-style mapping; its installed version and license must be recorded.
- `rokoko_studio_live` is a free/proprietary candidate, not an open-source dependency; its use is allowed only on the media host and must be recorded as such.
- `native_blender` means Blender built-in tools or a project-owned script.
- The probe writes `retargetPlugin.status: not_run`; choosing a plugin does not change `retargetStatus`.

## Acceptance

- Invalid catalog entries fail closed: unknown format, missing license state, invalid URL/source combination, or non-positive FPS.
- Blender probe imports a local BVH without mutating the source `.blend` and emits a deterministic manifest.
- A successful probe is not shown as retargeted; `retargetStatus` remains `unmapped` until target rig validation passes.
- No browser upload control accepts BVH/FBX/GLB in this slice.

## Next slice

Select three licensed or explicitly approved local samples, create bone maps against the current white-model rig, run rest-pose and parent-space quaternion checks, then render one martial sample and one foot-contact sample on the media host.
