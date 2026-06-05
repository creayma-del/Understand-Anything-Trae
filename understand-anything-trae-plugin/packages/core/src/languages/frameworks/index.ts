import type { FrameworkConfig } from "../types.js";

import { reactConfig } from "./react.js";
import { nextjsConfig } from "./nextjs.js";
import { nuxtConfig } from "./nuxt.js";
import { expressConfig } from "./express.js";
import { vueConfig } from "./vue.js";
import { sveltekitConfig } from "./sveltekit.js";

// Order matters for detection priority: more specific frameworks should come
// before their base frameworks (e.g., Nuxt before Vue) so that detection
// returns the more precise match first.
export const builtinFrameworkConfigs: FrameworkConfig[] = [
  reactConfig,
  nextjsConfig,
  nuxtConfig,
  expressConfig,
  vueConfig,
  sveltekitConfig,
];

export {
  reactConfig,
  nextjsConfig,
  nuxtConfig,
  expressConfig,
  vueConfig,
  sveltekitConfig,
};
