import { track } from "./mixpanelClient";

export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  track(eventName, properties);
};

export const trackUIEvent = {
  pageView: (path: string, title?: string) => trackEvent("page_viewed", { path, title }),
  buttonClick: (button_type: string, extra?: Record<string, any>) =>
    trackEvent("button_clicked", { button_type, ...extra }),
  linkClick: (link_type: string, href?: string) => trackEvent("link_clicked", { link_type, href }),
};
