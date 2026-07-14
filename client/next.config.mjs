import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  // The vendored `src/vendor/shared/*` contracts are TS source that imports with
  // explicit `.js` specifiers (matching `moduleResolution: "Bundler"` in tsconfig).
  // tsc resolves `.js`→`.ts`, but webpack does not by default, so the moment a
  // client module imports a RUNTIME value through the `@devdigest/shared` barrel
  // (e.g. the Zod `EvalExpectation` schema used for client-side eval-case
  // validation — the first such value-import in the client, everything else is
  // `import type`), webpack fails to resolve `./contracts/*.js`. This alias teaches
  // webpack the same `.js`→`.ts` fallback; it only adds resolution candidates, so
  // real `.js` files still resolve.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
