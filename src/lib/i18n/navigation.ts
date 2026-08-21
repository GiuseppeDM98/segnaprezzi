import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Guide: always import Link, redirect, usePathname, useRouter, getPathname
// from this module — never from next/link or next/navigation directly —
// so every navigation is locale-aware.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
