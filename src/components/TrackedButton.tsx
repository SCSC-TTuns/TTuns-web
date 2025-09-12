'use client';

import React from 'react';
import { trackUIEvent } from '@/lib/mixpanel/trackEvent';
import Link from 'next/link';

{/*
How to use
1. href
<TrackedButton
    href="/submit"
    button_type="add_survey_button"
    className="px-4 py-2 bg-gray-300 text-black rounded-md hover:bg-gray-400 transition-colors text-sm font-medium"
>
    내 설문도 추가하기
</TrackedButton>

2. onclick
<TrackedButton
  href={`/${itemType}/${event.url_id}`}
  button_type={event.event}
  className="flex flex-col w-full text-left"
>
  <div className="flex items-center justify-between w-full">
    <span className="font-medium text-gray-800 truncate max-w-[90%]" title={event.event}>
      {event.event.length > 50 ? `${event.event.substring(0, 50)}...` : event.event}
    </span>
    <ArrowRight className="h-4 w-4 text-gray-400 flex-shrink-0 ml-2" />
  </div>
  
  {event.category && event.category.length > 0 && (
    <div className="flex flex-wrap gap-2 mt-2">
      {event.category.map((tag: string, index: number) => (
        <span 
          key={`${event.url_id}-${index}`}
          className="text-sm font-medium text-blue-600 bg-blue-100 px-3 py-1 rounded-full whitespace-nowrap"
        >
          {tag}
        </span>
      ))}
    </div>
  )}
</TrackedButton>
*/}

interface CommonProps {
  button_type: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void;
}

interface LinkVariantProps extends CommonProps, Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps | 'href'> {
  href: string;
}

interface ButtonVariantProps extends CommonProps, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> {
  href?: never;
}

type Props = LinkVariantProps | ButtonVariantProps;

export default function TrackedButton(props: Props) {
  const { button_type, children, className, onClick, disabled } = props;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    trackUIEvent.buttonClick(button_type, props.href);
    if (onClick) {
      onClick(e);
    }
  };

  if (props.href) {
    const { href, ...rest } = props as LinkVariantProps;
    const { button_type: _bt, children: _ch, className: _cn, onClick: _oc, disabled: _di, ...linkRest } = rest;

    return (
      <Link
        href={href}
        onClick={handleClick}
        className={className}
        aria-disabled={disabled}
        style={disabled ? { pointerEvents: 'none', opacity: 0.5 } : {}}
        {...linkRest}
      >
        {children}
      </Link>
    );
  } else {
    const { href: _h, ...rest } = props as ButtonVariantProps;
    const { button_type: _bt, children: _ch, className: _cn, onClick: _oc, disabled: _di, type, ...buttonRest } = rest;

    return (
      <button
        type={type || "button"}
        onClick={handleClick}
        className={className}
        disabled={disabled}
        {...buttonRest}
      >
        {children}
      </button>
    );
  }
}