import * as React from "react";

type LogoProps = {
  className?: string;
  priority?: boolean;
};

export function Logo({ className = "h-15 w-auto sm:h-16" }: LogoProps) {
  return (
    <span className="inline-flex items-center">
      {/* Light theme logo shown when dark class is not on html */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/light_logo.png"
        alt="Speakomo"
        className={`block object-contain dark:hidden ${className}`}
      />
      {/* Dark theme logo shown when dark class is on html */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/dark_logo.png"
        alt="Speakomo"
        className={`hidden object-contain dark:block ${className}`}
      />
    </span>
  );
}

export default Logo;

