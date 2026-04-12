import React from 'react';

/* ------------------------------------------------------------------ */
/*  Card — compound-pattern card component (Tailwind, no Bootstrap)   */
/* ------------------------------------------------------------------ */

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

interface HeaderProps {
  className?: string;
  borderless?: boolean;
  children?: React.ReactNode;
}

interface BodyProps {
  className?: string;
  children?: React.ReactNode;
}

interface FooterProps {
  className?: string;
  borderless?: boolean;
  children?: React.ReactNode;
}

function CardRoot({ className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
}

function Header({ className = '', borderless = false, children }: HeaderProps) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-3 ${borderless ? '' : 'border-b border-gray-200'} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

function Body({ className = '', children }: BodyProps) {
  return <div className={`px-4 py-3 ${className}`.trim()}>{children}</div>;
}

function Footer({
  className = '',
  borderless = false,
  children,
}: FooterProps) {
  return (
    <div
      className={`px-4 py-3 ${borderless ? '' : 'border-t border-gray-200'} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export const Card = Object.assign(CardRoot, { Header, Body, Footer });
