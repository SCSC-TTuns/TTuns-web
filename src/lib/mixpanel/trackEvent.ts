// lib/mixpanel/trackEvent.ts
import { track } from './mixpanelClient';

/**
 * Track a custom event with properties
 * @param eventName - Name of the event to track
 * @param properties - Additional properties to send with the event
 */
export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  track(eventName, properties);
};

// Pre-defined event tracking functions for better type safety and consistency
export const trackChatEvent = {
  messageSent: (conversationId: string, messageLength: number) => {
    track('chat_message_sent', {
      conversation_id: conversationId,
      message_length: messageLength,
      message_type: 'user'
    });
  },
  
  aiResponseReceived: (conversationId: string, responseLength: number, responseTime: number) => {
    track('ai_response_received', {
      conversation_id: conversationId,
      response_length: responseLength,
      response_time_ms: responseTime,
      message_type: 'assistant'
    });
  },
  
  conversationStarted: (conversationId: string) => {
    track('conversation_started', {
      conversation_id: conversationId
    });
  },
  
  conversationDeleted: (conversationId: string, messageCount: number) => {
    track('conversation_deleted', {
      conversation_id: conversationId,
      message_count: messageCount
    });
  },
  
  conversationRenamed: (conversationId: string, newTitle: string) => {
    track('conversation_renamed', {
      conversation_id: conversationId,
      new_title_length: newTitle.length
    });
  }
};

export const trackUIEvent = {
  buttonClick: (buttonType: string, targetUrl?: string) => {
    track('button_click', {
      button_type: buttonType,
      ...(targetUrl && { target_url: targetUrl })
    });
  },
  
  sidebarToggle: (isOpen: boolean) => {
    track('sidebar_toggle', {
      is_open: isOpen,
      device_type: window.innerWidth < 768 ? 'mobile' : 'desktop'
    });
  },
  
  pageView: (page: string, title: string) => {
    track('page_view', {
      page,
      title,
      referrer: document.referrer,
      user_agent: navigator.userAgent,
      screen_resolution: `${screen.width}x${screen.height}`,
      viewport_size: `${window.innerWidth}x${window.innerHeight}`
    });
  }
};