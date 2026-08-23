// Flat config. Next 16 removed the `next lint` CLI and the `eslint` key in
// next.config, so linting runs as its own step through the ESLint CLI
// (`npm run lint`) and as its own gate in CI — before typecheck and tests.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "playwright-report/**",
      "test-results/**",
      "infra/**",
    ],
  },
  ...coreWebVitals,
  ...nextTypescript,
];

export default config;
