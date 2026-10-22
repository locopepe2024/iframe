"use client";

import { useEffect, useRef, useState } from "react";
import { photoApi, type FaceBox } from "@/lib/photoApi";

export default function FacePhoto({ photoId, boxes, onReady }: { photoId: string; boxes: FaceBox[]; onReady?: (ready: boolean) => void }) {
  const [url, setUrl] = useState(""), [error, setError] = useState(false);
  const readiness = useRef(onReady); readiness.current = onReady;
  useEffect(() => {
    let active = true, objectUrl = "";
    setUrl(""); setError(false); readiness.current?.(false);
    void photoApi.image(photoId).then(blob => {
      if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photoId]);
  return url ? <div style={{ position: "relative", width: "100%" }}>
    <img src={url} onLoad={() => readiness.current?.(true)} onError={() => { setError(true); setUrl(""); readiness.current?.(false); }} alt="请核对照片中边框标出的人脸" style={{ display: "block", width: "100%", height: "auto" }} />
    {boxes.map((box, index) => <span key={index} aria-hidden="true" style={{ position: "absolute", pointerEvents: "none", left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%`, border: "3px solid #ffeb3b", boxShadow: "0 0 0 1px #172331", boxSizing: "border-box" }} />)}
  </div> : <p role={error ? "alert" : "status"}>{error ? "照片暂时无法读取，请刷新人物进度后再核对。" : "正在读取照片…"}</p>;
}
