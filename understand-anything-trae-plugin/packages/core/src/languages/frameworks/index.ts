import type { FrameworkConfig } from "../types.js";

import { djangoConfig } from "./django.js";
import { fastapiConfig } from "./fastapi.js";
import { flaskConfig } from "./flask.js";
import { reactConfig } from "./react.js";
import { nextjsConfig } from "./nextjs.js";
import { expressConfig } from "./express.js";
import { vueConfig } from "./vue.js";

export const builtinFrameworkConfigs: FrameworkConfig[] = [
  djangoConfig,
  fastapiConfig,
  flaskConfig,
  reactConfig,
  nextjsConfig,
  expressConfig,
  vueConfig,
];

export {
  djangoConfig,
  fastapiConfig,
  flaskConfig,
  reactConfig,
  nextjsConfig,
  expressConfig,
  vueConfig,
};
