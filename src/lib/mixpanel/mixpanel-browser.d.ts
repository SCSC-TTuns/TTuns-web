import "mixpanel-browser";

declare module "mixpanel-browser" {
  interface OverridedMixpanel {
    __loaded: boolean;
  }
}
