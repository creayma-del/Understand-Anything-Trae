import type { FrameworkConfig } from "../types.js";

import { reactConfig } from "./react.js";
import { nextjsConfig } from "./nextjs.js";
import { expressConfig } from "./express.js";
import { vueConfig } from "./vue.js";

export const builtinFrameworkConfigs: FrameworkConfig[] = [
  reactConfig,
  nextjsConfig,
  expressConfig,
  vueConfig,
];

export {
  reactConfig,
  nextjsConfig,
  expressConfig,
  vueConfig,
};
