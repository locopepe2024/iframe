from fractions import Fraction
from io import BytesIO
import json
from pathlib import Path
import subprocess
import os
import time
from unittest.mock import Mock

from fastapi import HTTPException
import pytest

from src.apps.identity import UserContext
from src.apps.recreation import analysis
from src.apps.recreation.service import RecreationService


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return RecreationService(UserContext("user", "profile", "User", ""))


@pytest.fixture
def video(tmp_path):
    path = tmp_path / "input.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=red:s=96x64:r=24:d=1",
        "-f", "lavfi", "-i", "color=blue:s=96x64:r=24:d=1",
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0,select=not(eq(mod(n\\,3)\\,1))[v]",
        "-map", "[v]", "-fps_mode", "vfr", "-c:v", "libx264", str(path),
    ], check=True, timeout=30)
    return path


def register(service, video):
    with video.open("rb") as stream:
        return service.register(stream, video.name)


def completed(service, video):
    project = register(service, video)
    queued = service.start(project["id"], project["revision"])
    service.process(project["id"], queued["analysis_id"])
    result = service.get(project["id"])
    assert result["status"] == "review", result["error"]
    return result


def test_real_vfr_analysis_and_confirmation(service, video):
    project = completed(service, video)
    data = project["analysis"]
    pts = data["frame_pts"]
    tb = Fraction(data["time_base"])
    assert len({b - a for a, b in zip(pts, pts[1:])}) > 1
    assert data["audio_streams"] == 0
    assert data["end_pts"] > pts[-1]
    assert len(data["candidates"]) == 1
    candidate = data["candidates"][0]
    assert candidate["pts"] * tb == 1
    assert candidate["before_pts"] == pts[pts.index(candidate["pts"]) - 1]
    from PIL import Image
    with Image.open(Path("output") / candidate["before_url"]) as image:
        assert image.getpixel((10, 10))[0] > 200
    with Image.open(Path("output") / candidate["after_url"]) as image:
        assert image.getpixel((10, 10))[2] > 200
    assert len({s["pts"] for s in data["samples"]}) == len(data["samples"])
    confirmed = service.confirm(project["id"], project["revision"], project["analysis_id"], [candidate["pts"]])
    assert confirmed["status"] == "confirmed"
    assert confirmed["timeline"]["shots"][-1]["end_pts"] == data["end_pts"]
    assert RecreationService(service.user).get(project["id"])["timeline"] == confirmed["timeline"]
    with pytest.raises(HTTPException) as exc:
        service.confirm(project["id"], project["revision"], project["analysis_id"], [])
    assert exc.value.status_code == 409


def test_cross_owner_cannot_read_start_or_confirm(service, video):
    record = register(service, video)
    stranger = RecreationService(UserContext("other", "other-profile", "Other", ""))
    assert stranger.list() == []
    for call in [lambda: stranger.get(record["id"]), lambda: stranger.start(record["id"], 0),
                 lambda: stranger.confirm(record["id"], 0, "x", [])]:
        with pytest.raises(HTTPException) as exc:
            call()
        assert exc.value.status_code == 404


def test_duplicate_start_and_explicit_cancel_cannot_publish(service, video, monkeypatch):
    record = register(service, video)
    first = service.start(record["id"], 0)
    with pytest.raises(HTTPException):
        service.start(record["id"], first["revision"])
    with service.db() as db:
        state = service._get(db, record["id"])
        state["started_at"] = time.time() - 601
        service._save(db, state)
    still_running = service.get(record["id"])
    assert still_running["status"] == "queued"
    cancelled = service.cancel_analysis(record["id"], still_running["revision"], first["analysis_id"])
    assert cancelled["status"] == "cancelled"
    second = service.start(record["id"], cancelled["revision"])
    runner = Mock()
    monkeypatch.setattr("src.apps.recreation.service.analyze", runner)
    service.process(record["id"], first["analysis_id"])
    runner.assert_not_called()
    assert service.get(record["id"])["analysis_id"] == second["analysis_id"]


def test_cancel_analysis_is_owner_and_revision_scoped(service, video):
    record = register(service, video)
    queued = service.start(record["id"], record["revision"])
    stranger = RecreationService(UserContext("other", "other-profile", "Other", ""))
    with pytest.raises(HTTPException) as exc:
        stranger.cancel_analysis(record["id"], queued["revision"], queued["analysis_id"])
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        service.cancel_analysis(record["id"], queued["revision"] - 1, queued["analysis_id"])
    assert exc.value.status_code == 409
    cancelled = service.cancel_analysis(record["id"], queued["revision"], queued["analysis_id"])
    assert cancelled["status"] == "cancelled"


def test_corruption_and_explicit_retry(service):
    record = service.register(BytesIO(b"not video"), "bad.mp4")
    first = service.start(record["id"], 0)
    service.process(record["id"], first["analysis_id"])
    failed = service.get(record["id"])
    assert failed["status"] == "failed" and failed["error"]
    second = service.start(record["id"], failed["revision"])
    assert second["attempt"] == 2 and second["analysis_id"] != first["analysis_id"]


def test_source_mutation_rejected(service, video):
    record = completed(service, video)
    (Path("output") / record["source_url"]).write_bytes(b"changed")
    with pytest.raises(HTTPException, match="fingerprint"):
        service.confirm(record["id"], record["revision"], record["analysis_id"], [])
    retry = service.start(record["id"], record["revision"])
    service.process(record["id"], retry["analysis_id"])
    assert "fingerprint" in service.get(record["id"])["error"]


def test_symlink_source_escape_fails(service, video):
    record = register(service, video)
    source = Path("output") / record["source_url"]
    source.unlink()
    source.symlink_to(video)
    queued = service.start(record["id"], 0)
    service.process(record["id"], queued["analysis_id"])
    assert "outside" in service.get(record["id"])["error"]


def test_media_search_is_owner_scoped_and_cursor_paginated(service, video):
    record = register(service, video)
    result = service.search_media(query="input", kind="source_video", limit=1)
    assert len(result["items"]) == 1
    assert result["items"][0]["media_id"] == record["source_media_id"]
    assert service.search_media(project_id="missing")["items"] == []


def test_timeout_is_explicit(monkeypatch):
    monkeypatch.setattr(subprocess, "run", Mock(side_effect=subprocess.TimeoutExpired("ffmpeg", 90)))
    with pytest.raises(ValueError, match="timed out"):
        analysis.run(["ffmpeg"])


def test_assembly_media_timeout_is_explicit(monkeypatch):
    monkeypatch.setattr(subprocess, "run", Mock(side_effect=subprocess.TimeoutExpired("ffmpeg", 1)))
    with pytest.raises(ValueError, match="timed out"):
        RecreationService._run_media_command(["ffmpeg"], timeout=1)


def test_derived_index_and_manual_evidence_survive_confirmation(service, video):
    record = completed(service, video)
    rows = service.search_media(project_id=record["id"], limit=100)["items"]
    assert {"source_video", "contact_sheet", "evidence_frame"} <= {r["kind"] for r in rows}
    assert len({r["storage_path"] for r in rows}) == len(rows)
    assert all(len(r["sha256"]) == 64 for r in rows)
    cut = record["analysis"]["frame_pts"][2]
    pair = service.evidence(record["id"], record["analysis_id"], cut)
    confirmed = service.confirm(record["id"], record["revision"], record["analysis_id"], [cut])
    assert confirmed["analysis"]["manual_evidence"][str(cut)] == pair
    restarted = RecreationService(service.user)
    assert restarted.evidence(record["id"], record["analysis_id"], cut) == pair
    before = restarted.search_media(project_id=record["id"], limit=100)
    restarted.reindex(record["id"])
    assert restarted.search_media(project_id=record["id"], limit=100) == before
    found, cursor = [], 0
    while cursor is not None:
        page = restarted.search_media(project_id=record["id"], limit=2, cursor=cursor)
        found.extend(r["media_id"] for r in page["items"])
        cursor = page["next_cursor"]
    assert found == [r["media_id"] for r in before["items"]]
    stranger = RecreationService(UserContext("other", "other-profile", "Other", ""))
    assert stranger.search_media(project_id=record["id"])["items"] == []
    with pytest.raises(HTTPException):
        stranger.reindex(record["id"])


def test_reindex_backfills_old_analysis_without_changing_timeline(service, video):
    record = completed(service, video)
    confirmed = service.confirm(record["id"], record["revision"], record["analysis_id"], [])
    with service.db() as db:
        db.execute("DELETE FROM media_records WHERE project_id=? AND kind!='source_video'", (record["id"],))
    assert len(service.search_media(project_id=record["id"])["items"]) == 1
    rebuilt = service.reindex(record["id"])
    assert rebuilt["timeline"] == confirmed["timeline"]
    assert rebuilt["revision"] == confirmed["revision"]
    assert len(service.search_media(project_id=record["id"])["items"]) > 1


def test_index_failure_is_retryable_and_rolls_back_partial_records(service, video, monkeypatch):
    record = register(service, video)
    queued = service.start(record["id"], 0)
    original = service._index_analysis
    def fail_after_index(db, current):
        original(db, current)
        raise OSError("disk failure")
    monkeypatch.setattr(service, "_index_analysis", fail_after_index)
    service.process(record["id"], queued["analysis_id"])
    failed = service.get(record["id"])
    assert failed["status"] == "failed"
    assert "indexing" in failed["error"]
    assert len(service.search_media(project_id=record["id"])["items"]) == 1


def test_non_frame_or_unsorted_cuts_rejected(service, video):
    record = completed(service, video)
    frames = record["analysis"]["frame_pts"]
    for cuts in [[frames[0]], [frames[1] + 1], [frames[2], frames[1]], [frames[1], frames[1]]]:
        with pytest.raises(HTTPException) as exc:
            service.confirm(record["id"], record["revision"], record["analysis_id"], cuts)
        assert exc.value.status_code == 422


def test_api_registration_analysis_evidence_and_confirmation(service, video, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.recreation.api import router
    from src.apps.studio_access import require_studio_user, verify_studio_media, verify_studio_media_preview
    from urllib.parse import urlsplit, parse_qs
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    assert client.get("/recreation/projects").status_code == 401
    app.dependency_overrides[require_studio_user] = lambda: service.user
    model_response = client.get("/recreation/models")
    assert model_response.status_code == 200
    assert model_response.json()["defaults"]["image_model"] == "uniart/gpt-image-2"
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-only-signing-key")
    with video.open("rb") as source:
        response = client.post("/recreation/projects", files={"file": ("original.mp4", source, "video/mp4")})
    assert response.status_code == 201
    project = response.json()
    signed = urlsplit(project["source_url"])
    owner, path = signed.path.removeprefix("/studio/media/").split("/", 1)
    query = parse_qs(signed.query)
    assert Path(verify_studio_media(owner, path, int(query["expires"][0]), query["signature"][0])).is_file()
    url = f"/recreation/projects/{project['id']}"
    assert client.post(url + "/analyze", json={"revision": 0}).status_code == 202
    project = client.get(url).json()
    assert project["status"] == "review"
    candidate = project["analysis"]["candidates"][0]
    preview = urlsplit(candidate["before_preview_url"])
    preview_query = parse_qs(preview.query)
    preview_owner, preview_path = preview.path.removeprefix("/studio/media/").split("/", 1)
    assert preview_query["preview"] == ["512"]
    assert Path(verify_studio_media_preview(
        preview_owner, preview_path, 512, int(preview_query["expires"][0]), preview_query["signature"][0]
    )).is_file()
    media_page = client.get("/recreation/media", params={"kind": "sample_frame"}).json()
    assert media_page["items"]
    assert media_page["items"][0]["preview_url"].startswith("/studio/media/")
    cut = project["analysis"]["frame_pts"][2]
    pair = client.post(url + "/evidence", json={"analysis_id": project["analysis_id"], "pts": cut})
    assert pair.status_code == 200
    assert pair.json()["before_url"].startswith("/studio/media/")
    assert pair.json()["before_preview_url"].startswith("/studio/media/")
    assert client.put(url + "/timeline", json={"revision": project["revision"],
        "analysis_id": project["analysis_id"], "cut_pts": [cut + 0.5]}).status_code == 422
    assert client.put(url + "/timeline", json={"revision": project["revision"],
        "analysis_id": project["analysis_id"], "cut_pts": [cut]}).status_code == 200


def test_studio_media_preview_endpoint_resizes_and_caches_image(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from PIL import Image, ImageFilter
    from src.apps.comic_gen.api import get_studio_media
    from src.apps.identity import UserContext
    from src.apps.studio_access import studio_media_preview_url, studio_owner_key
    from urllib.parse import parse_qs, urlsplit

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-only-signing-key")
    owner = UserContext("user", "profile", "User", "")
    owner_root = Path("output/users") / studio_owner_key(owner.owner_profile_id) / "studio"
    source = owner_root / "recreation" / "source.png"
    source.parent.mkdir(parents=True)
    Image.effect_noise((1600, 900), 100).convert("RGB").filter(ImageFilter.GaussianBlur(0.4)).save(source, "PNG")
    stored_path = source.relative_to("output").as_posix()
    signed = studio_media_preview_url(owner.owner_profile_id, stored_path, max_edge=320)
    parsed = urlsplit(signed)

    app = FastAPI()
    app.add_api_route("/studio/media/{owner_key}/{relative_path:path}", get_studio_media)
    client = TestClient(app)
    response = client.get(parsed.path + "?" + parsed.query)
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    assert len(response.content) < source.stat().st_size
    with Image.open(BytesIO(response.content)) as thumbnail:
        assert thumbnail.format == "WEBP"
        assert max(thumbnail.size) <= 320

    repeated = client.get(parsed.path + "?" + parsed.query)
    assert repeated.status_code == 200
    assert repeated.content == response.content
    assert repeated.headers["cache-control"].startswith("private")

    query = parse_qs(parsed.query)
    query["preview"] = ["960"]
    changed_query = "&".join(f"{key}={values[0]}" for key, values in query.items())
    assert client.get(parsed.path + "?" + changed_query).status_code == 401


@pytest.mark.parametrize("size", [(40_000_001, 1), (18_000, 10_000)])
def test_studio_media_preview_rejects_decompression_bombs(tmp_path, monkeypatch, size):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from PIL import Image
    from src.apps.comic_gen.api import get_studio_media
    from src.apps.identity import UserContext
    from src.apps.studio_access import studio_media_preview_url, studio_owner_key
    from urllib.parse import urlsplit
    import zlib

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-only-signing-key")
    owner = UserContext("user", "profile", "User", "")
    owner_root = Path("output/users") / studio_owner_key(owner.owner_profile_id) / "studio"
    source = owner_root / "recreation" / "oversized.png"
    source.parent.mkdir(parents=True)
    png = BytesIO()
    Image.new("RGB", (1, 1)).save(png, "PNG")
    data = bytearray(png.getvalue())
    dimensions = size[0].to_bytes(4, "big") + size[1].to_bytes(4, "big")
    data[16:24] = dimensions
    data[29:33] = zlib.crc32(b"IHDR" + dimensions).to_bytes(4, "big")
    source.write_bytes(data)

    signed = studio_media_preview_url(
        owner.owner_profile_id,
        source.relative_to("output").as_posix(),
        max_edge=320,
    )
    parsed = urlsplit(signed)
    app = FastAPI()
    app.add_api_route("/studio/media/{owner_key}/{relative_path:path}", get_studio_media)
    response = TestClient(app).get(parsed.path + "?" + parsed.query)

    assert response.status_code == 415
    assert not list((owner_root / ".media-previews").glob("*.webp"))


@pytest.mark.skipif(not os.getenv("LUMENX_RECREATION_SAMPLE"), reason="Optional authorized source-video acceptance")
def test_authorized_fifteen_second_source(service):
    record = completed(service, Path(os.environ["LUMENX_RECREATION_SAMPLE"]))
    data = record["analysis"]
    tb = Fraction(data["time_base"])
    # The sample is a 24 fps source whose final frame extends the media
    # duration to 15.083333 seconds.  Accept the frame-boundary padding while
    # still guarding that this remains the intended roughly-fifteen-second
    # acceptance sample.
    assert 15 <= data["duration_seconds"] <= 15 + (2 / 24)
    # The acceptance clip may be CFR or VFR; the dedicated synthetic fixture
    # above covers VFR timing.  For this authorized clip, require a decoded
    # frame sequence rather than assuming a particular encoder cadence.
    assert len(data["frame_pts"]) >= 300
    assert all(b > a for a, b in zip(data["frame_pts"], data["frame_pts"][1:]))
    cuts = []
    for value in ["4.016667", "9.083333", "10.400000"]:
        point = min(data["frame_pts"], key=lambda p: abs((p - data["start_pts"]) * tb - Fraction(value)))
        frame_gaps = [b - a for a, b in zip(data["frame_pts"], data["frame_pts"][1:])]
        max_frame_duration = Fraction(max(frame_gaps), 1) * tb
        # Timestamp labels are rounded to six decimals and the acceptance
        # clip may use a different frame cadence than the original fixture.
        # Snap to the nearest decoded source frame, within half the largest
        # observed frame interval.
        assert abs((point - data["start_pts"]) * tb - Fraction(value)) <= max_frame_duration / 2 + Fraction(1, 1000000)
        cuts.append(point)
    result = service.confirm(record["id"], record["revision"], record["analysis_id"], cuts)
    assert len(result["timeline"]["shots"]) == 4
    assert [c["pts"] for c in result["timeline"]["cuts"]] == cuts
    assert data["end_pts"] > data["frame_pts"][-1]


def image_stream():
    from PIL import Image
    stream = BytesIO()
    Image.new("RGB", (20, 20), "red").save(stream, format="PNG")
    stream.seek(0)
    return stream


def test_shot_references_survive_only_unchanged_boundaries(service, video):
    p = completed(service, video)
    cuts = [p["analysis"]["candidates"][0]["pts"]]
    p = service.confirm(p["id"], p["revision"], p["analysis_id"], cuts)
    reference = service.search_media(kind="evidence_frame")["items"][0]
    replacement = service.upload_image(p["id"], image_stream(), "product.png", "replacement_image")
    original_hash = reference["sha256"]
    edited = service.upload_image(p["id"], image_stream(), "edited.png", "reference_image", reference["media_id"])
    assert edited["metadata"]["parent_media_id"] == reference["media_id"]
    assert service.media(reference["media_id"])["sha256"] == original_hash
    shot_id = p["timeline"]["shots"][0]["id"]
    revision = p["revision"]
    p = service.bind_shot(p["id"], shot_id, revision, p["analysis_id"], edited["media_id"], replacement["media_id"], "Replace yellow box only")
    assert service.get(p["id"])["timeline"] == p["timeline"]
    with pytest.raises(HTTPException) as exc:
        service.bind_shot(p["id"], shot_id, revision, p["analysis_id"], None, None, "")
    assert exc.value.status_code == 409
    old = p["timeline"]["shots"]
    p = service.confirm(p["id"], p["revision"], p["analysis_id"], cuts)
    assert p["timeline"]["shots"] == old
    p = service.confirm(p["id"], p["revision"], p["analysis_id"], [p["analysis"]["frame_pts"][1], *cuts])
    assert p["timeline"]["shots"][-1] == old[-1]
    assert all("reference_media_id" not in shot for shot in p["timeline"]["shots"][:-1])
    assert service.media(edited["media_id"])["media_id"] == edited["media_id"]


def test_reference_ownership_kinds_and_fingerprints(service, video):
    p = completed(service, video)
    p = service.confirm(p["id"], p["revision"], p["analysis_id"], [])
    shot = p["timeline"]["shots"][0]["id"]
    foreign = RecreationService(UserContext("other", "other", "Other", ""))
    other = register(foreign, video)
    image = foreign.upload_image(other["id"], image_stream(), "foreign.png", "reference_image")
    for bad_id, status in [(image["media_id"], 404), (p["source_media_id"], 422)]:
        with pytest.raises(HTTPException) as exc:
            service.bind_shot(p["id"], shot, p["revision"], p["analysis_id"], bad_id, None, "")
        assert exc.value.status_code == status
    with pytest.raises(HTTPException) as exc:
        service.upload_image(p["id"], image_stream(), "edit.png", "reference_image", image["media_id"])
    assert exc.value.status_code == 404
    image = service.upload_image(p["id"], image_stream(), "product.png", "replacement_image")
    (Path("output") / image["storage_path"]).write_bytes(b"changed")
    with pytest.raises(HTTPException) as exc:
        service.bind_shot(p["id"], shot, p["revision"], p["analysis_id"], None, image["media_id"], "")
    assert exc.value.status_code == 409


def test_invalid_image_upload_cleans_files_and_index(service, video):
    p = register(service, video)
    for stream, status in [(BytesIO(b"not image"), 422), (BytesIO(b"x" * (25 * 1024 * 1024 + 1)), 413)]:
        with pytest.raises(HTTPException) as exc:
            service.upload_image(p["id"], stream, "fake.png", "reference_image")
        assert exc.value.status_code == status
    assert service.search_media(kind="reference_image")["items"] == []
    assert list((service.root / p["id"] / "images").iterdir()) == []


def test_reference_api_upload_signing_binding_and_owner_isolation(service, video, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.recreation.api import router
    from src.apps.studio_access import require_studio_user
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-only-signing-key")
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    app.dependency_overrides[require_studio_user] = lambda: service.user
    p = completed(service, video)
    p = service.confirm(p["id"], p["revision"], p["analysis_id"], [])
    response = client.post(f'/recreation/projects/{p["id"]}/images', data={"kind": "replacement_image"}, files={"file": ("product.png", image_stream(), "image/png")})
    assert response.status_code == 201
    media = response.json()
    assert "?" in media["storage_path"]
    source = service.search_media(project_id=p["id"], kind="sample_frame")["items"][0]
    monkeypatch.setattr(RecreationService, "process_keyframe_task", lambda self, task_id: None)
    task_response = client.post(
        f'/recreation/projects/{p["id"]}/shots/{p["timeline"]["shots"][0]["id"]}/keyframe-tasks',
        json={"revision": p["revision"], "analysis_id": p["analysis_id"],
              "reference_media_id": source["media_id"], "replacement_media_id": media["media_id"],
              "instruction": "Replace the red box", "accept_cost": True},
    )
    assert task_response.status_code == 202
    assert "prompt" not in task_response.json()
    assert client.get(f'/recreation/keyframe-tasks/{task_response.json()["task_id"]}').status_code == 200
    listed = client.get(f'/recreation/projects/{p["id"]}/keyframe-tasks', params={"shot_id": p["timeline"]["shots"][0]["id"]})
    assert listed.status_code == 200 and [item["task_id"] for item in listed.json()] == [task_response.json()["task_id"]]
    endpoint = f'/recreation/projects/{p["id"]}/shots/{p["timeline"]["shots"][0]["id"]}/references'
    payload = {"revision": p["revision"], "analysis_id": p["analysis_id"], "replacement_media_id": media["media_id"]}
    assert client.put(endpoint, json=payload).status_code == 200
    assert client.put(endpoint, json=payload).status_code == 409
    assert client.get(f'/recreation/media/{media["media_id"]}').status_code == 200
    app.dependency_overrides[require_studio_user] = lambda: UserContext("foreign", "foreign", "Foreign", "")
    assert client.get(f'/recreation/media/{media["media_id"]}').status_code == 404
    assert client.get(f'/recreation/keyframe-tasks/{task_response.json()["task_id"]}').status_code == 404
    assert client.get(f'/recreation/projects/{p["id"]}/keyframe-tasks').status_code == 404
    assert client.put(endpoint, json=payload).status_code == 404


def test_generation_plan_requires_explicit_inputs_and_preserves_order(service, video):
    p = completed(service, video)
    p = service.confirm(p['id'], p['revision'], p['analysis_id'], [])
    plan = service.generation_plan(p['id'], p['revision'])
    assert not plan['ready']
    assert set(plan['blockers'][0]['reasons']) == {'description_required', 'reference_required', 'generation_duration_required'}
    ref = service.upload_image(p['id'], image_stream(), 'frame.png', 'reference_image')
    product = service.upload_image(p['id'], image_stream(), 'product.png', 'replacement_image')
    shot = p['timeline']['shots'][0]
    p = service.bind_shot(p['id'], shot['id'], p['revision'], p['analysis_id'], ref['media_id'], product['media_id'], 'Replace yellow box only', 'Medium shot; hand lifts box; static camera.')
    plan = service.generation_plan(p['id'], p['revision'], generation_durations={shot['id']: 5})
    assert plan['ready']
    assert plan['submission_enabled'] is True
    assert plan['guidance']['sha256']
    with pytest.raises(HTTPException) as unsupported:
        service.generation_plan(p['id'], p['revision'], model='uniart/seedance-2.5-vip')
    assert unsupported.value.status_code == 422
    preserved = service.generation_plan(p['id'], p['revision'], audio_policy='preserve_source', generation_durations={shot['id']: 5})
    assert not preserved['ready']
    assert 'source_audio_unavailable' in preserved['blockers'][0]['reasons']
    row = plan['shots'][0]
    assert [i['media_id'] for i in row['images']] == [ref['media_id'], product['media_id']]
    assert [i['label'] for i in row['images']] == ['<Picture 1>', '<Picture 2>']
    assert plan['source_video'] == {'media_id': p['source_media_id'], 'sha256': p['source_fingerprint'], 'label': '<Video 1>'}
    assert '<Video 1>' in row['prompt']
    assert Fraction(row['target_duration']) == (shot['end_pts'] - shot['start_pts']) * Fraction(p['analysis']['time_base'])
    assert 'overall_soundscape:\nN/A' in row['prompt']
    assert service.get(p['id'])['revision'] == p['revision']
    with pytest.raises(HTTPException) as exc:
        service.generation_plan(p['id'], p['revision'] - 1)
    assert exc.value.status_code == 409
    p = service.bind_shot(p['id'], shot['id'], p['revision'], p['analysis_id'], ref['media_id'], product['media_id'], '', 'Use @1')
    assert set(service.generation_plan(p['id'], p['revision'], generation_durations={shot['id']: 5})['blockers'][0]['reasons']) == {'replacement_instruction_required', 'media_labels_reserved'}
    (Path('output') / ref['storage_path']).write_bytes(b'changed')
    with pytest.raises(HTTPException) as exc:
        service.generation_plan(p['id'], p['revision'])
    assert exc.value.status_code == 409


def test_generation_submit_maps_missing_source_to_conflict(service, video):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.recreation.api import router
    from src.apps.studio_access import require_studio_user

    project = completed(service, video)
    project = service.confirm(project['id'], project['revision'], project['analysis_id'], [])
    reference = service.upload_image(project['id'], image_stream(), 'frame.png', 'reference_image')
    shot = project['timeline']['shots'][0]
    project = service.bind_shot(project['id'], shot['id'], project['revision'], project['analysis_id'],
                                reference['media_id'], None, '', 'Static shot.')
    (Path('output') / project['source_url']).unlink()

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_studio_user] = lambda: service.user
    client = TestClient(app)
    response = client.post(
        f"/recreation/projects/{project['id']}/generation-tasks",
        json={"revision": project['revision'], "generation_durations": {shot['id']: 5}, "accept_cost": True},
    )
    assert response.status_code == 409
    assert 'register the source again' in response.json()['detail']


def test_keyframe_task_generates_indexed_reference_without_binding(service, video, monkeypatch):
    p = completed(service, video)
    p = service.confirm(p['id'], p['revision'], p['analysis_id'], [])
    source = service.search_media(project_id=p['id'], kind='sample_frame')['items'][0]
    product = service.upload_image(p['id'], image_stream(), 'product.png', 'replacement_image')
    shot = p['timeline']['shots'][0]

    task = service.create_keyframe_task(
        p['id'], shot['id'], p['revision'], p['analysis_id'],
        source['media_id'], product['media_id'],
        f'Replace the red box with @{{{product["media_id"]}}}; keep the hand in front.', True,
    )
    assert task['status'] == 'pending'
    assert task['prompt_sha256'] and 'prompt' not in task

    def generate(_self, prompt, output_path, **kwargs):
        assert kwargs['model_name'] == 'uniart/gpt-image-2'
        assert kwargs['ref_image_paths'] == [
            str((Path('output') / source['storage_path']).resolve()),
            str((Path('output') / product['storage_path']).resolve()),
        ]
        assert 'Image 1' in prompt and 'Image 2' in prompt and product['media_id'] not in prompt
        from PIL import Image
        Image.new('RGB', (96, 64), 'green').save(output_path, 'PNG')
        return output_path, 0.1

    monkeypatch.setattr('src.models.uniart.UniArtImageModel.generate', generate)
    service.process_keyframe_task(task['task_id'], {'api_key': 'never-persisted'})
    done = service.keyframe_task(task['task_id'])
    assert done['status'] == 'completed', done
    output = done['output_media']
    assert output['kind'] == 'reference_image'
    assert output['metadata']['parent_media_id'] == source['media_id']
    assert output['metadata']['replacement_media_id'] == product['media_id']
    assert service.get(p['id'])['timeline']['shots'][0].get('reference_media_id') is None


def test_keyframe_task_rejects_non_editing_model_before_persisting(service, video):
    p = completed(service, video)
    p = service.confirm(p['id'], p['revision'], p['analysis_id'], [])
    source = service.search_media(project_id=p['id'], kind='sample_frame')['items'][0]
    product = service.upload_image(p['id'], image_stream(), 'product.png', 'replacement_image')
    shot = p['timeline']['shots'][0]

    with pytest.raises(HTTPException) as exc:
        service.create_keyframe_task(
            p['id'], shot['id'], p['revision'], p['analysis_id'], source['media_id'], product['media_id'],
            'Replace the red box', True, model='uniart/minimax-h3-vip',
        )
    assert exc.value.status_code == 422
    assert service.keyframe_tasks(p['id'], shot['id']) == []


def test_keyframe_task_accepts_current_owner_editing_model(service, video, monkeypatch):
    p = completed(service, video)
    p = service.confirm(p['id'], p['revision'], p['analysis_id'], [])
    source = service.search_media(project_id=p['id'], kind='sample_frame')['items'][0]
    product = service.upload_image(p['id'], image_stream(), 'product.png', 'replacement_image')
    shot = p['timeline']['shots'][0]
    monkeypatch.setattr(service, '_live_uniart_models', lambda: [
        {'id': 'uniart/gpt-image-2.5-flare-discount', 'capabilities': ['t2i', 'i2i']},
    ])

    task = service.create_keyframe_task(
        p['id'], shot['id'], p['revision'], p['analysis_id'], source['media_id'], product['media_id'],
        'Replace the red box', True, model='uniart/gpt-image-2.5-flare-discount',
    )
    assert task['model'] == 'uniart/gpt-image-2.5-flare-discount'


def test_recreation_model_options_keep_unverified_video_contracts_hidden(service, monkeypatch):
    monkeypatch.setattr(service, '_live_uniart_models', lambda: [
        {'id': 'uniart/gpt-image-2', 'display_name': 'GPT Image 2', 'capabilities': ['t2i', 'i2i']},
        {'id': 'uniart/minimax-h3-vip', 'display_name': 'MiniMax H3', 'capabilities': ['r2v']},
        {'id': 'uniart/seedance-2.5-vip', 'display_name': 'Seedance', 'capabilities': ['r2v']},
    ])
    options = service.model_options()
    assert [item['id'] for item in options['image_models']] == ['uniart/gpt-image-2']
    assert [item['id'] for item in options['video_models']] == ['uniart/minimax-h3-vip']
    assert options['defaults'] == {'image_model': 'uniart/gpt-image-2', 'video_model': 'uniart/minimax-h3-vip'}


def test_generation_submission_persists_provider_task_and_indexes_video(service, video, monkeypatch):
    p = completed(service, video)
    p = service.confirm(p['id'], p['revision'], p['analysis_id'], [])
    ref = service.upload_image(p['id'], image_stream(), 'frame.png', 'reference_image')
    product = service.upload_image(p['id'], image_stream(), 'product.png', 'replacement_image')
    shot = p['timeline']['shots'][0]
    p = service.bind_shot(p['id'], shot['id'], p['revision'], p['analysis_id'], ref['media_id'], product['media_id'],
                          'Replace the package only', 'Medium shot, product remains stable.')
    submitted = service.submit_generation(p['id'], p['revision'], generation_durations={shot['id']: 5}, accept_cost=True)
    assert len(submitted['tasks']) == 1
    task_id = submitted['tasks'][0]['task_id']
    assert submitted['tasks'][0]['source_media_id'] == p['source_media_id']
    assert submitted['tasks'][0]['source_fingerprint'] == p['source_fingerprint']

    def generate(_self, prompt, output_path, **kwargs):
        assert '<Picture 1>' in prompt and '<Picture 2>' in prompt and '<Video 1>' in prompt
        assert kwargs['model'] == 'uniart/minimax-h3-vip'
        assert kwargs['mode'] == 'reference2video'
        assert kwargs['duration'] == 5
        assert kwargs['generate_audio'] is False
        assert len(kwargs['ref_image_urls']) == 2
        assert kwargs['ref_video_urls'] == [str((Path('output') / p['source_url']).resolve())]
        kwargs['on_task_submitted']('provider-task-1')
        Path(output_path).write_bytes(b'fake-mp4')
        return output_path, 0.1

    monkeypatch.setattr('src.models.uniart.UniArtVideoModel.generate', generate)
    service.process_generation_task(task_id, {'api_key': 'never-persisted'})
    done = service.generation_task(task_id)
    assert done['status'] == 'completed', done
    assert done['provider_task_id'] == 'provider-task-1'
    assert done['output_media']['kind'] == 'generated_video'
    assert service.search_media(project_id=p['id'], kind='generated_video')['items']


def test_generation_worker_rejects_changed_source_before_provider_submission(service, video, monkeypatch):
    project = completed(service, video)
    project = service.confirm(project['id'], project['revision'], project['analysis_id'], [])
    reference = service.upload_image(project['id'], image_stream(), 'frame.png', 'reference_image')
    shot = project['timeline']['shots'][0]
    project = service.bind_shot(project['id'], shot['id'], project['revision'], project['analysis_id'],
                                reference['media_id'], None, '', 'Static shot.')
    submitted = service.submit_generation(project['id'], project['revision'],
                                          generation_durations={shot['id']: 5}, accept_cost=True)
    source_path = Path('output') / project['source_url']
    source_path.write_bytes(b'changed-after-submit')
    provider = Mock()
    monkeypatch.setattr('src.models.uniart.UniArtVideoModel.generate', provider)

    service.process_generation_task(submitted['tasks'][0]['task_id'], {'api_key': 'never-persisted'})
    failed = service.generation_task(submitted['tasks'][0]['task_id'])
    assert failed['status'] == 'failed'
    assert 'source fingerprint' in failed['error']
    provider.assert_not_called()


def test_generation_worker_can_use_signed_disk_media_url(service, video, monkeypatch):
    project = completed(service, video)
    project = service.confirm(project['id'], project['revision'], project['analysis_id'], [])
    reference = service.upload_image(project['id'], image_stream(), 'frame.png', 'reference_image')
    shot = project['timeline']['shots'][0]
    project = service.bind_shot(project['id'], shot['id'], project['revision'], project['analysis_id'],
                                reference['media_id'], None, '', 'Static shot.')
    submitted = service.submit_generation(project['id'], project['revision'],
                                          generation_durations={shot['id']: 5}, accept_cost=True)
    monkeypatch.setenv('UNIART_MEDIA_BASE_URL', 'https://iframe.example.test')
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-only')

    def generate(_self, _prompt, output_path, **kwargs):
        assert kwargs['ref_image_urls'][0].startswith('https://iframe.example.test/studio/media/')
        assert kwargs['ref_video_urls'][0].startswith('https://iframe.example.test/studio/media/')
        assert all('signature=' in value for value in kwargs['ref_image_urls'] + kwargs['ref_video_urls'])
        Path(output_path).write_bytes(b'disk-url-mp4')
        return output_path, 0.1

    monkeypatch.setattr('src.models.uniart.UniArtVideoModel.generate', generate)
    service.process_generation_task(submitted['tasks'][0]['task_id'], {'api_key': 'never-persisted'})
    assert service.generation_task(submitted['tasks'][0]['task_id'])['status'] == 'completed'


def test_generation_worker_recovery_resumes_only_with_saved_provider_id(service, video, monkeypatch):
    project = completed(service, video)
    project = service.confirm(project['id'], project['revision'], project['analysis_id'], [])
    reference = service.upload_image(project['id'], image_stream(), 'frame.png', 'reference_image')
    shot = project['timeline']['shots'][0]
    project = service.bind_shot(project['id'], shot['id'], project['revision'], project['analysis_id'],
                                reference['media_id'], None, '', 'Static shot.')
    submitted = service.submit_generation(project['id'], project['revision'],
                                          generation_durations={shot['id']: 5}, accept_cost=True)
    task_id = submitted['tasks'][0]['task_id']
    with service.db() as db:
        task = service._generation_task(db, task_id)
        task.update(status='processing', provider_task_id='provider-recovered', updated_at=time.time())
        db.execute('UPDATE recreation_generation_tasks SET data=? WHERE task_id=? AND owner=?',
                   (json.dumps(task), task_id, service.user.owner_profile_id))

    def generate(_self, _prompt, output_path, **kwargs):
        assert kwargs['resume_task_id'] == 'provider-recovered'
        assert kwargs['model'] == 'uniart/minimax-h3-vip'
        Path(output_path).write_bytes(b'recovered-mp4')
        return output_path, 0.1

    monkeypatch.setattr('src.models.uniart.UniArtVideoModel.generate', generate)
    monkeypatch.setattr('src.apps.studio_access.runtime_uniart_for_owner', lambda *_args: {'api_key': 'runtime-only'})

    class ImmediateThread:
        def __init__(self, target, args=(), daemon=None):
            self.target, self.args = target, args

        def start(self):
            self.target(*self.args)

    monkeypatch.setattr('src.apps.recreation.service.threading.Thread', ImmediateThread)
    service.recover_generation_tasks()
    recovered = service.generation_task(task_id)
    assert recovered['status'] == 'completed', recovered
    assert recovered['provider_task_id'] == 'provider-recovered'


def test_generation_worker_recovers_legacy_saved_provider_without_new_source_snapshot(service, video, monkeypatch):
    project = completed(service, video)
    project = service.confirm(project['id'], project['revision'], project['analysis_id'], [])
    reference = service.upload_image(project['id'], image_stream(), 'frame.png', 'reference_image')
    shot = project['timeline']['shots'][0]
    project = service.bind_shot(project['id'], shot['id'], project['revision'], project['analysis_id'],
                                reference['media_id'], None, '', 'Static shot.')
    submitted = service.submit_generation(project['id'], project['revision'],
                                          generation_durations={shot['id']: 5}, accept_cost=True)
    task_id = submitted['tasks'][0]['task_id']
    with service.db() as db:
        task = service._generation_task(db, task_id)
        task.pop('source_media_id')
        task.pop('source_fingerprint')
        task.update(status='processing', provider_task_id='legacy-provider-task', updated_at=time.time())
        db.execute('UPDATE recreation_generation_tasks SET data=? WHERE task_id=? AND owner=?',
                   (json.dumps(task), task_id, service.user.owner_profile_id))

    def generate(_self, _prompt, output_path, **kwargs):
        assert kwargs['resume_task_id'] == 'legacy-provider-task'
        assert 'ref_image_urls' not in kwargs and 'ref_video_urls' not in kwargs
        Path(output_path).write_bytes(b'legacy-recovered-mp4')
        return output_path, 0.1

    monkeypatch.setattr('src.models.uniart.UniArtVideoModel.generate', generate)
    service.process_generation_task(task_id, {'api_key': 'never-persisted'})
    assert service.generation_task(task_id)['status'] == 'completed'


def test_generation_worker_marks_interrupted_submission_failed_without_resubmitting(service, video, monkeypatch):
    project = completed(service, video)
    project = service.confirm(project['id'], project['revision'], project['analysis_id'], [])
    reference = service.upload_image(project['id'], image_stream(), 'frame.png', 'reference_image')
    shot = project['timeline']['shots'][0]
    project = service.bind_shot(project['id'], shot['id'], project['revision'], project['analysis_id'],
                                reference['media_id'], None, '', 'Static shot.')
    submitted = service.submit_generation(project['id'], project['revision'],
                                          generation_durations={shot['id']: 5}, accept_cost=True)
    task_id = submitted['tasks'][0]['task_id']
    with service.db() as db:
        task = service._generation_task(db, task_id)
        task.update(status='processing', provider_task_id=None, updated_at=time.time())
        db.execute('UPDATE recreation_generation_tasks SET data=? WHERE task_id=? AND owner=?',
                   (json.dumps(task), task_id, service.user.owner_profile_id))
    provider = Mock()
    monkeypatch.setattr('src.models.uniart.UniArtVideoModel.generate', provider)

    service.process_generation_task(task_id, {'api_key': 'never-persisted'})
    failed = service.generation_task(task_id)
    assert failed['status'] == 'failed'
    assert 'upstream task ID' in failed['error']
    provider.assert_not_called()


def test_generation_and_assembly_task_lists_are_ordered_from_json_timestamps(service, video, monkeypatch):
    project = completed(service, video)
    project = service.confirm(project['id'], project['revision'], project['analysis_id'], [])
    reference = service.upload_image(project['id'], image_stream(), 'frame.png', 'reference_image')
    shot = project['timeline']['shots'][0]
    project = service.bind_shot(project['id'], shot['id'], project['revision'], project['analysis_id'],
                                reference['media_id'], None, '', 'Static shot.')
    submitted = service.submit_generation(project['id'], project['revision'],
                                          generation_durations={shot['id']: 5}, accept_cost=True)
    listed = service.generation_tasks(project['id'])
    assert [task['task_id'] for task in listed] == [submitted['tasks'][0]['task_id']]

    def generate(_self, _prompt, output_path, **kwargs):
        Path(output_path).write_bytes(b'fake-mp4')
        return output_path, 0.1

    monkeypatch.setattr('src.models.uniart.UniArtVideoModel.generate', generate)
    service.process_generation_task(submitted['tasks'][0]['task_id'], {'api_key': 'never-persisted'})
    assembly = service.submit_assembly(project['id'], project['revision'], submitted['generation_id'])
    listed_assemblies = service.assembly_tasks(project['id'])
    assert [task['task_id'] for task in listed_assemblies] == [assembly['task_id']]


def test_generation_cancel_prevents_late_result_and_is_owner_scoped(service, video, monkeypatch):
    p = completed(service, video)
    p = service.confirm(p['id'], p['revision'], p['analysis_id'], [])
    ref = service.upload_image(p['id'], image_stream(), 'frame.png', 'reference_image')
    shot = p['timeline']['shots'][0]
    p = service.bind_shot(p['id'], shot['id'], p['revision'], p['analysis_id'], ref['media_id'], None, '', 'Static shot.')
    submitted = service.submit_generation(p['id'], p['revision'], generation_durations={shot['id']: 5}, accept_cost=True)
    task_id = submitted['tasks'][0]['task_id']

    def generate(_self, _prompt, output_path, **kwargs):
        kwargs['on_task_submitted']('provider-task-cancelled')
        service.cancel_generation_task(task_id)
        Path(output_path).write_bytes(b'late-result')
        return output_path, 0.1

    monkeypatch.setattr('src.models.uniart.UniArtVideoModel.generate', generate)
    service.process_generation_task(task_id, {'api_key': 'never-persisted'})
    assert service.generation_task(task_id)['status'] == 'cancelled', service.generation_task(task_id)
    assert service.search_media(project_id=p['id'], kind='generated_video')['items'] == []
    stranger = RecreationService(UserContext('other', 'other', 'Other', ''))
    with pytest.raises(HTTPException) as exc:
        stranger.generation_task(task_id)
    assert exc.value.status_code == 404


def _ready_generation(service, video, monkeypatch, *, audio_policy="silent", clip_seconds=5):
    project = completed(service, video)
    project = service.confirm(project["id"], project["revision"], project["analysis_id"], [])
    reference = service.upload_image(project["id"], image_stream(), "frame.png", "reference_image")
    shot = project["timeline"]["shots"][0]
    project = service.bind_shot(project["id"], shot["id"], project["revision"], project["analysis_id"],
                                reference["media_id"], None, "", "Static shot.")
    submitted = service.submit_generation(
        project["id"], project["revision"], audio_policy=audio_policy,
        soundscape="Generated audio only" if audio_policy == "generated" else "",
        generation_durations={shot["id"]: 5}, accept_cost=True,
    )

    def generate(_self, _prompt, output_path, **kwargs):
        command = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                   f"color=green:s=96x64:r=24:d={clip_seconds}"]
        if kwargs["generate_audio"]:
            command += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={clip_seconds}",
                        "-shortest", "-c:a", "aac"]
        command += ["-c:v", "libx264", "-pix_fmt", "yuv420p", output_path]
        subprocess.run(command, check=True, timeout=30)
        kwargs["on_task_submitted"]("provider-assembly-test")
        return output_path, 0.1

    monkeypatch.setattr("src.models.uniart.UniArtVideoModel.generate", generate)
    service.process_generation_task(submitted["tasks"][0]["task_id"], {"api_key": "never-persisted"})
    return project, submitted, service.generation_task(submitted["tasks"][0]["task_id"])


def test_assembly_crops_completed_shot_and_indexes_final_video(service, video, monkeypatch):
    project, submitted, generation = _ready_generation(service, video, monkeypatch, clip_seconds=5)
    assembly = service.submit_assembly(project["id"], project["revision"], submitted["generation_id"])
    assert assembly["status"] == "pending"
    service.process_assembly_task(assembly["task_id"])
    done = service.assembly_task(assembly["task_id"])
    assert done["status"] == "completed", done
    final = done["output_media"]
    assert final["kind"] == "final_video"
    assert final["metadata"]["audio_policy"] == "silent"
    assert final["metadata"]["audio_streams"] == 0
    probe = service._probe_assembly_media(Path("output") / final["storage_path"])
    target = Fraction(project["timeline"]["shots"][0]["end_pts"] - project["timeline"]["shots"][0]["start_pts"]) * Fraction(project["analysis"]["time_base"])
    assert abs(probe["duration"] - float(target)) < 0.08
    assert service.search_media(project_id=project["id"], kind="final_video")["items"]


def test_assembly_rejects_short_generated_clip_without_stretching(service, video, monkeypatch):
    project, submitted, _generation = _ready_generation(service, video, monkeypatch, clip_seconds=0.5)
    assembly = service.submit_assembly(project["id"], project["revision"], submitted["generation_id"])
    service.process_assembly_task(assembly["task_id"])
    failed = service.assembly_task(assembly["task_id"])
    assert failed["status"] == "failed"
    assert "shorter than the required" in failed["error"]
    assert failed["output_media"] is None


@pytest.fixture
def video_with_audio(tmp_path):
    path = tmp_path / "input-audio.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=red:s=96x64:r=24:d=2",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest",
        "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", str(path),
    ], check=True, timeout=30)
    return path


def test_assembly_preserves_source_audio_by_timeline_intervals(service, video_with_audio, monkeypatch):
    project, submitted, _generation = _ready_generation(service, video_with_audio, monkeypatch,
                                                        audio_policy="preserve_source", clip_seconds=5)
    assembly = service.submit_assembly(project["id"], project["revision"], submitted["generation_id"])
    service.process_assembly_task(assembly["task_id"])
    done = service.assembly_task(assembly["task_id"])
    assert done["status"] == "completed", done
    assert done["output_media"]["metadata"]["audio_policy"] == "preserve_source"
    assert done["output_media"]["metadata"]["audio_streams"] == 1


def test_assembly_keeps_generated_audio_when_policy_is_generated(service, video, monkeypatch):
    project, submitted, _generation = _ready_generation(service, video, monkeypatch,
                                                        audio_policy="generated", clip_seconds=5)
    assembly = service.submit_assembly(project["id"], project["revision"], submitted["generation_id"])
    service.process_assembly_task(assembly["task_id"])
    done = service.assembly_task(assembly["task_id"])
    assert done["status"] == "completed", done
    assert done["output_media"]["metadata"]["audio_policy"] == "generated"
    assert done["output_media"]["metadata"]["audio_streams"] == 1


def test_assembly_cancel_is_owner_scoped_and_prevents_publication(service, video, monkeypatch):
    project, submitted, _generation = _ready_generation(service, video, monkeypatch)
    assembly = service.submit_assembly(project["id"], project["revision"], submitted["generation_id"])
    stranger = RecreationService(UserContext("other", "other", "Other", ""))
    with pytest.raises(HTTPException) as exc:
        stranger.cancel_assembly_task(assembly["task_id"])
    assert exc.value.status_code == 404
    cancelled = service.cancel_assembly_task(assembly["task_id"])
    assert cancelled["status"] == "cancelled"
    service.process_assembly_task(assembly["task_id"])
    assert service.assembly_task(assembly["task_id"])["output_media"] is None


def test_keyframe_task_rejects_cost_stale_and_duplicate(service, video):
    p = completed(service, video)
    p = service.confirm(p['id'], p['revision'], p['analysis_id'], [])
    source = service.search_media(project_id=p['id'], kind='sample_frame')['items'][0]
    product = service.upload_image(p['id'], image_stream(), 'product.png', 'replacement_image')
    shot = p['timeline']['shots'][0]
    args = (p['id'], shot['id'], p['revision'], p['analysis_id'], source['media_id'], product['media_id'], 'Replace the red box')
    with pytest.raises(HTTPException) as exc:
        service.create_keyframe_task(*args, False)
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException) as exc:
        service.create_keyframe_task(p['id'], shot['id'], p['revision'], p['analysis_id'], source['media_id'], product['media_id'], f'@{{{product["media_id"]}}}', True)
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException) as exc:
        service.create_keyframe_task(p['id'], shot['id'], p['revision'], p['analysis_id'], product['media_id'], product['media_id'], 'Replace the red box', True)
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException) as exc:
        service.create_keyframe_task(p['id'], shot['id'], p['revision'] - 1, p['analysis_id'], source['media_id'], product['media_id'], 'Replace the red box', True)
    assert exc.value.status_code == 409
    first = service.create_keyframe_task(*args, True)
    with pytest.raises(HTTPException) as exc:
        service.create_keyframe_task(*args, True)
    assert exc.value.status_code == 409
    stranger = RecreationService(UserContext('other', 'other', 'Other', ''))
    with pytest.raises(HTTPException) as exc:
        stranger.keyframe_task(first['task_id'])
    assert exc.value.status_code == 404
    cancelled = service.cancel_keyframe_task(first['task_id'])
    assert cancelled['status'] == 'cancelled'
    assert service.keyframe_task(first['task_id'])['status'] == 'cancelled'
    replacement = service.create_keyframe_task(*args, True)
    with pytest.raises(HTTPException) as exc:
        stranger.cancel_keyframe_task(replacement['task_id'])
    assert exc.value.status_code == 404


def test_keyframe_failure_creates_no_media(service, video, monkeypatch):
    p = completed(service, video)
    p = service.confirm(p['id'], p['revision'], p['analysis_id'], [])
    source = service.search_media(project_id=p['id'], kind='sample_frame')['items'][0]
    product = service.upload_image(p['id'], image_stream(), 'product.png', 'replacement_image')
    shot = p['timeline']['shots'][0]
    task = service.create_keyframe_task(p['id'], shot['id'], p['revision'], p['analysis_id'], source['media_id'], product['media_id'], 'Replace the red box', True)
    monkeypatch.setattr('src.models.uniart.UniArtImageModel.generate', Mock(side_effect=RuntimeError('provider failed')))
    service.process_keyframe_task(task['task_id'], {})
    failed = service.keyframe_task(task['task_id'])
    assert failed['status'] == 'failed' and failed['error'] == 'provider failed'
    assert failed['output_media'] is None
    assert service.search_media(project_id=p['id'], kind='reference_image')['items'] == []
