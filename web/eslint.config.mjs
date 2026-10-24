import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      ".next/**",
      "out/**",
      "next-env.d.ts",
      "src/generated/**",
      ".devdb/**",
      "coverage/**",
    ],
  },
];

export default eslintConfig;
