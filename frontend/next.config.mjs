/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const isDocker = process.env.DOCKER_BUILD === 'true';
const isTauri = process.env.TAURI_BUILD === 'true';
const previewBasePath = process.env.IFRAME_PREVIEW_BASE_PATH;

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:17177';

// Tauri build: output to frontend/out/ with no basePath (loaded via Tauri protocol)
// Docker build: output to frontend/out/
// Default prod: output to ../static/ with /static basePath
const nextConfig = {
    webpack(config) {
        // Filerobot is client-only; Konva's server entry must not require native canvas.
        config.resolve.alias = { ...config.resolve.alias, canvas: false };
        return config;
    },
    output: isProd ? 'export' : undefined,
    distDir: isProd ? (isTauri || isDocker || previewBasePath ? 'out' : '../static') : undefined,
    basePath: isProd && !isDocker && !isTauri ? (previewBasePath || '/static') : undefined,
    assetPrefix: isProd && !isDocker && !isTauri ? (previewBasePath || '/static') : undefined,
    // Dev-only: proxy /api-proxy/* to backend to avoid CORS issues (e.g. file downloads)
    async rewrites() {
        return isProd ? [] : [
            {
                source: '/api-proxy/:path*',
                destination: `${BACKEND_URL}/:path*`,
            },
        ];
    },
    eslint: {
        ignoreDuringBuilds: true,
    },
    typescript: {
        ignoreBuildErrors: true,
    },
    images: {
        unoptimized: true,
        remotePatterns: [
            {
                protocol: "https",
                hostname: "placehold.co",
            },
            {
                protocol: "http",
                hostname: "localhost",
                port: "17177",
            },
        ],
    },
};

export default nextConfig;
