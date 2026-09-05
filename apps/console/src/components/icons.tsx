import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
  'aria-hidden': true,
};

export function OverviewIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    </svg>
  );
}

export function CustomerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20v-2.5A5.5 5.5 0 0 1 10.5 12h3a5.5 5.5 0 0 1 5.5 5.5V20z" />
    </svg>
  );
}

export function AuditIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h6" />
    </svg>
  );
}

export function OperationsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m14.7 6.3 3-3 3 3-3 3M9.3 17.7l-3 3-3-3 3-3M8 16l8-8M8.5 4.5l2 2M13.5 17.5l2 2" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 7v5h-5M4 17v-5h5M18.2 9A7 7 0 0 0 6 7l-2 5M5.8 15A7 7 0 0 0 18 17l2-5" />
    </svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m8 10 4 4 4-4" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </svg>
  );
}
