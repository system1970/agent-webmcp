"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { docsNavigation } from "./navigation";

export function DocsSidebarNav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-row gap-6 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:gap-5 lg:overflow-visible">
      {docsNavigation.map((section) => (
        <div key={section.title ?? "top"}>
          {section.title ? (
            <p className="mb-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-ink-2">
              {section.title}
            </p>
          ) : null}
          <ul className="flex flex-row gap-1 lg:flex-col">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "block whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13.5px] font-medium text-ink"
                        : "block whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13.5px] text-ink-2 transition-colors hover:bg-black/[0.04] hover:text-ink"
                    }
                  >
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
