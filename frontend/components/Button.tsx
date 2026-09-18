import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  children: ReactNode;
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'py-2.5 px-3 text-[11px] tracking-[0.06em]',
  sm: 'py-[7px] px-3.5 text-xs tracking-[0.05em]',
  md: 'py-3 px-5 text-xs tracking-[0.05em]',
  lg: 'py-4 px-5 text-[13px] tracking-[0.1em]',
};

// Mirrors the shared Button.dc.html design-system component (Claude Design
// project "Sistema de diseño frontend reutilizable") — same 4 variants x 4
// sizes, same disabled treatment (dim to 55% opacity rather than per-variant
// disabled colors). Keep both in sync if either changes.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'border-0 bg-ink font-semibold uppercase text-white hover:text-accent',
  outline: 'border border-ink bg-white font-semibold uppercase text-ink hover:bg-ink hover:text-white',
  ghost: 'border-0 bg-transparent p-0 font-mono text-[11px] uppercase tracking-[0.06em] text-[#71717a] hover:text-ink',
  danger: 'border-0 bg-transparent p-0 text-xs text-muted underline underline-offset-2 hover:text-red-600',
};

/** Shared with any non-<button> element (e.g. a Next `<Link>`) that needs to look like a Button — see Header's "Log in" link. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', full = false, disabled = false): string {
  const isGhostOrDanger = variant === 'ghost' || variant === 'danger';
  return [
    'inline-flex items-center justify-center gap-2.5 leading-[1.1]',
    full ? 'w-full' : 'w-auto',
    isGhostOrDanger ? '' : SIZE_CLASSES[size],
    VARIANT_CLASSES[variant],
    disabled ? 'opacity-55' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button({ variant = 'primary', size = 'md', full = false, disabled, children, ...rest }: ButtonProps) {
  return (
    <button type="button" disabled={disabled} className={buttonClasses(variant, size, full, disabled)} {...rest}>
      {children}
    </button>
  );
}
