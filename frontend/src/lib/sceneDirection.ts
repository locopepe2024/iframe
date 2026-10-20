/** Director coordinates: Z up, azimuth zero at -Y, positive azimuth towards +X. */
export function sceneDirection(azimuth: number, elevation: number): [number, number, number] {
    const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
    return [Math.cos(e) * Math.sin(a), -Math.cos(e) * Math.cos(a), Math.sin(e)];
}

export function sceneAngles([x, y, z]: [number, number, number], poleAzimuth = 0) {
    const radius = Math.hypot(x, y, z);
    if (!radius) throw new Error("方向向量不能为零");
    return {
        azimuth: Math.hypot(x, y) < 1e-8 ? poleAzimuth : Math.atan2(x, -y) * 180 / Math.PI,
        elevation: Math.asin(Math.max(-1, Math.min(1, z / radius))) * 180 / Math.PI,
    };
}

export function describeSceneDirection(azimuth: number, elevation: number) {
    if (elevation >= 60) return "顶部";
    if (elevation <= -60) return "底部";
    const a = ((azimuth % 360) + 360) % 360;
    const side = a < 22.5 || a >= 337.5 ? "前方" : a < 67.5 ? "右前方" : a < 112.5 ? "右侧"
        : a < 157.5 ? "右后方" : a < 202.5 ? "后方" : a < 247.5 ? "左后方" : a < 292.5 ? "左侧" : "左前方";
    return `${side}${elevation >= 20 ? "上方" : elevation <= -20 ? "下方" : ""}`;
}
