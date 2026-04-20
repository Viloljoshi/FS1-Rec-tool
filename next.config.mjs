/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '15mb'
    }
  },
  serverExternalPackages: ['natural', 'neo4j-driver', 'pino'],
  typescript: {
    ignoreBuildErrors: false
  },
  eslint: {
    ignoreDuringBuilds: true
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // `natural` pulls in `apparatus` → `sylvester` → optional native `lapack`. Stub it.
      config.resolve.alias = {
        ...config.resolve.alias,
        lapack: false
      };
    }
    return config;
  }
};

export default nextConfig;
