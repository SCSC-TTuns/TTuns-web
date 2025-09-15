"use client";

import React from "react";
import Link from "next/link";
import { trackUIEvent } from "@/lib/mixpanel/trackEvent";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> &
  React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    button_type: string;
    href?: string;
  };

export default function TrackedButton(props: Props) {
  const { button_type, href, onClick, children, className, disabled, type, ...rest } = props;

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    trackUIEvent.buttonClick(button_type, href ? { href } : undefined);
    if (onClick) (onClick as any)(e);
  };

  if (href) {
    return (
      <Link href={href} onClick={handleClick as any} className={className} {...(rest as any)}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type || "button"}
      onClick={handleClick}
      className={className}
      disabled={disabled}
      {...(rest as any)}
    >
      {children}
    </button>
  );
}
