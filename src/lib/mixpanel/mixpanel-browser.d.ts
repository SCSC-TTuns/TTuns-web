// lib/mixpanel/mixpanel-browser.d.ts
import { Mixpanel } from "mixpanel-browser";

declare module "mixpanel-browser" {
  interface Mixpanel {
    __loaded: boolean;
  }
}
