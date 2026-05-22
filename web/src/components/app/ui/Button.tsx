import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
}

/*
 * Three-variant button matching the visual vocabulary established by the
 * marketing landing (`.marketing .btn-primary` / `.btn-ghost`). The
 * primary variant gets a subtle inset highlight + accent-tinted shadow
 * so it reads as "the action" without being loud; secondary is bordered
 * neutral; ghost is text-only for tertiary actions inside cards.
 */
const variants = {
  primary: [
    'bg-gw-accent text-white border border-gw-accent',
    'shadow-[0_1px_0_rgba(255,255,255,0.1)_inset,0_6px_18px_rgba(42,111,201,0.18)]',
    'hover:bg-gw-accent-bright hover:border-gw-accent-bright',
    'hover:shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_10px_24px_rgba(42,111,201,0.28)]',
    'active:translate-y-px',
    'disabled:bg-gw-accent-soft disabled:border-gw-accent-soft disabled:text-gw-text-faint disabled:shadow-none',
  ].join(' '),
  secondary: [
    'bg-gw-surface-2 text-gw-text border border-gw-border',
    'hover:border-gw-border-bright hover:bg-gw-surface-3',
    'disabled:opacity-50',
  ].join(' '),
  ghost: [
    'bg-transparent text-gw-text-dim border border-transparent',
    'hover:text-gw-text hover:bg-gw-surface-2',
    'disabled:opacity-50',
  ].join(' '),
};

export function Button({ children, variant = 'primary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all duration-150 ease-out disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
