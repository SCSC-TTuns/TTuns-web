// lib/mixpanel/mixpanelClient.ts
'use client';

import mixpanel from 'mixpanel-browser';
import { getAnonymousId } from '@/lib/utils/anonymousId';

const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;

let isInitialized = false;

export function initMixpanel() {
  // Prevent multiple initializations
  if (isInitialized || !TOKEN) return;
  
  if (typeof window === 'undefined') {
    console.warn('Mixpanel: Cannot initialize on server side');
    return;
  }

  try {
    mixpanel.init(TOKEN, {
      debug: process.env.NODE_ENV === 'development',
      track_pageview: false, // We'll handle page views manually
      persistence: 'localStorage',
      ignore_dnt: true,
      secure_cookie: true,
      cross_subdomain_cookie: false,
      loaded: function() {
        // Set up anonymous user identification
        const anonId = getAnonymousId();
        if (anonId) {
          mixpanel.identify(anonId);
        }
        isInitialized = true;
        console.log('Mixpanel initialized successfully');
      }
    });
  } catch (error) {
    console.error('Mixpanel initialization failed:', error);
  }
}

// Safe tracking function with error handling
export function track(eventName: string, properties?: Record<string, any>) {
  if (!isInitialized) {
    console.warn(`Mixpanel: Cannot track "${eventName}" - not initialized`);
    return;
  }
  
  try {
    mixpanel.track(eventName, {
      timestamp: new Date().toISOString(),
      ...properties
    });
  } catch (error) {
    console.error(`Mixpanel tracking error for "${eventName}":`, error);
  }
}

// Utility to check if Mixpanel is ready
export function isReady(): boolean {
  return isInitialized;
}

export default mixpanel;