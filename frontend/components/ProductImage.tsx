import Image from 'next/image';
import type { ReactNode } from 'react';

const STRIPES = {
  backgroundColor: '#ffffff',
  backgroundImage: 'repeating-linear-gradient(135deg, #fafafa 0 9px, #f2f2f4 9px 18px)',
};

/**
 * Shows a product photo (white-background product shots, so `object-contain`
 * to avoid cropping) or falls back to the striped "no photo yet" placeholder
 * when `src` is null — e.g. a future product the catalog seed hasn't given
 * an image to. `children` renders as an absolute overlay (used for the "Pro"
 * badge by callers) on top of either state.
 */
export function ProductImage({
  src,
  alt,
  className,
  sizes,
  fallbackLabel,
  children,
}: {
  src: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  fallbackLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`relative overflow-hidden ${className ?? ''}`}
      style={src ? { backgroundColor: '#ffffff' } : STRIPES}
    >
      {src ? (
        <Image src={src} alt={alt} fill sizes={sizes ?? '240px'} className="object-contain p-2" />
      ) : (
        <span className="flex h-full items-center justify-center whitespace-pre-line px-3 text-center font-mono text-[9px] uppercase leading-relaxed tracking-wide text-[#b8b8be]">
          {fallbackLabel ?? `product shot\n${alt.toLowerCase()}\nwhite bg`}
        </span>
      )}
      {children}
    </div>
  );
}
