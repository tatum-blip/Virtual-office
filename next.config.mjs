/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Phaser is client-only — exclude from SSR bundle
    if (isServer) {
      config.externals = [...(config.externals || []), 'phaser']
    }
    return config
  },
}

export default nextConfig;
