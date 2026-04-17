/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@even-os/db', '@even-os/config', '@even-os/types'],

  // N.6: Native binaries (@napi-rs/canvas for OCR PDF rasterisation) and
  // tesseract.js's worker scripts/WASM must stay outside the webpack bundle
  // so Node can load them from node_modules at runtime.
  experimental: {
    serverComponentsExternalPackages: ['@napi-rs/canvas', 'tesseract.js', 'unpdf'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      externals.push({
        '@napi-rs/canvas': 'commonjs @napi-rs/canvas',
        'tesseract.js': 'commonjs tesseract.js',
      });
      config.externals = externals;
    }
    return config;
  },

  // Security headers (G-4.2 from 00E Bug Lessons)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
