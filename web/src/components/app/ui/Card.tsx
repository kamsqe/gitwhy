import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-gw-border bg-gw-surface-2 p-4 ${className}`}
    >
      {children}
    </div>
  );
}
