import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**"] },
  ...nextVitals,
  ...nextTypescript,
  reactHooks.configs.flat["recommended-latest"],
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off"
    },
    settings: {
      next: {
        rootDir: ["apps/internal/"]
      }
    }
  }
];
