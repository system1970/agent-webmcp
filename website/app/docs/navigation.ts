export interface DocsNavItem {
  name: string;
  href: string;
}

export interface DocsNavSection {
  title: string | null;
  items: DocsNavItem[];
}

/** Single source of truth for the docs sidebar. Add a page here and
 *  create app/docs/<slug>/page.tsx — nothing else to wire. */
export const docsNavigation: DocsNavSection[] = [
  {
    title: null,
    items: [
      { name: "Introduction", href: "/docs" },
      { name: "Installation", href: "/docs/installation" },
      { name: "Quick start", href: "/docs/quick-start" },
    ],
  },
  {
    title: "Reference",
    items: [
      { name: "Commands", href: "/docs/commands" },
      { name: "Custom tools", href: "/docs/custom-tools" },
      { name: "Jev loop", href: "/docs/jev-loop" },
    ],
  },
];
