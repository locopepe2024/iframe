"use client";

import dynamic from "next/dynamic";

const PhotoAlbum = dynamic(() => import("@/components/companion/photos/PhotoAlbum"), {
  ssr: false, loading: () => <p style={{ padding: 24, fontSize: 20 }}>正在打开相册…</p>,
});
export default function PhotosPage() { return <PhotoAlbum />; }
