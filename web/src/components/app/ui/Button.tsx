import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
}

const variants = {
  primary:
    'bg-gw-accent text-white hover:bg-blue-600 active:bg-blue-700 disabled:bg-blue-900 disabled:text-gw-text-faint',
  secondary:
    'bg-gw-surface-2 text-gw-text border border-gw-border hover:bg-gray-800 disabled:opacity-50',
  ghost:
    'bg-transparent text-gw-text-dim hover:text-gw-text hover:bg-gw-surface-2 disabled:opacity-50',
};

export function Button({ children, variant = 'primary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
