'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AuditIcon, CustomerIcon, OperationsIcon, OverviewIcon } from './icons';

const items = [
  { href: '/', label: 'Overview', icon: OverviewIcon },
  { href: '/customers', label: 'Customers', icon: CustomerIcon },
  { href: '/audit', label: 'Audit', icon: AuditIcon },
  { href: '/operations', label: 'Operations', icon: OperationsIcon },
];

export function Navigation() {
  const pathname = usePathname();
  return (
    <nav className="primary-nav" aria-label="Primary">
      {items.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
            aria-label={item.label}
          >
            <item.icon />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
