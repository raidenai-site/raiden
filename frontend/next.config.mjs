/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',           // Static export - generates out/ folder
  reactStrictMode: true,
  trailingSlash: true,        // Required for file:// protocol routing
  assetPrefix: './',          // Use relative paths for file:// protocol
  basePath: '',               // No base path for Electron
  images: {
    unoptimized: true,        // Next/Image doesn't work with static export
  },
};

export default nextConfig;

