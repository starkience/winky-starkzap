/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000', 'localhost:3001'],
    },
  },

  // Webpack config for starknet.js and Cartridge Controller compatibility
  webpack: (config, { isServer, dev }) => {
    // Required for starknet.js
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };

    // Support WASM modules (required by @cartridge/controller)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Fix Cartridge Controller WASM crash in dev mode.
    // Next.js dev sets a webpack target that doesn't allow async/await in output,
    // but asyncWebAssembly needs it. Tell webpack the output environment supports
    // async functions, arrow functions, and modules (all modern browsers do).
    if (!isServer) {
      config.output = {
        ...config.output,
        environment: {
          ...config.output?.environment,
          asyncFunction: true,
          forOf: true,
          destructuring: true,
          dynamicImport: true,
          module: true,
          arrowFunction: true,
          bigIntLiteral: true,
          optionalChaining: true,
        },
      };
    }

    return config;
  },
};

module.exports = nextConfig;
