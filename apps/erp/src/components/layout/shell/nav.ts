import {
  Bike,
  LayoutDashboard,
  ShoppingBag,
  Truck,
  Users,
  UtensilsCrossed,
  BedDouble,
  BookOpenText,
  Wallet,
  FileText,
  LockKeyhole,
  HandCoins,
  FileBarChart,
  History,
  UserCog,
  Settings,
} from "lucide-react";
import type { StaffRole } from "@/types";
import { greeting } from "@/lib/names";

export interface NavLink {
  key: string;
  label: string;
  href: string;
  icon: React.ElementType;
  roles: StaffRole[];
  /** Orders and Delivery use the orange edition of the theme. */
  accent?: "orange";
}

export interface NavGroup {
  label: string;
  items: NavLink[];
}

const OM: StaffRole[] = ["SUPER_ADMIN", "OPERATIONS_MANAGER"];
const O: StaffRole[] = ["SUPER_ADMIN"];

/** Manager ERP navigation. Visibility mirrors the server's section rules (sectionAccess.ts). */
export const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", items: [{ key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: OM }] },
  {
    label: "Operations",
    items: [
      { key: "orders", label: "Orders", href: "/orders", icon: ShoppingBag, roles: OM, accent: "orange" },
      { key: "delivery", label: "Delivery", href: "/delivery", icon: Truck, roles: OM, accent: "orange" },
      { key: "mydeliveries", label: "My Deliveries", href: "/my-deliveries", icon: Bike, roles: OM, accent: "orange" },
    ],
  },
  {
    label: "Customers",
    items: [
      { key: "residents", label: "Residents", href: "/residents", icon: Users, roles: OM },
      { key: "tiffin", label: "Tiffin Customers", href: "/tiffin", icon: UtensilsCrossed, roles: OM },
    ],
  },
  { label: "Property", items: [{ key: "rooms", label: "Rooms & Inventory", href: "/rooms", icon: BedDouble, roles: OM }] },
  {
    label: "Finance",
    items: [
      { key: "cashbook", label: "Cashbook", href: "/finance?tab=cashbook", icon: BookOpenText, roles: OM },
      { key: "receivables", label: "Dues", href: "/finance?tab=receivables", icon: HandCoins, roles: OM },
      { key: "invoices", label: "Bills", href: "/finance?tab=invoices", icon: FileText, roles: OM },
      { key: "closing", label: "Daily Closing", href: "/finance?tab=closing", icon: LockKeyhole, roles: OM },
    ],
  },
  {
    label: "Insights",
    items: [
      { key: "reports", label: "Reports", href: "/reports", icon: FileBarChart, roles: OM },
      { key: "activity", label: "Activity Log", href: "/activity", icon: History, roles: O },
    ],
  },
  {
    label: "Administration",
    items: [
      { key: "staff", label: "Staff", href: "/staff", icon: UserCog, roles: O },
      { key: "settings", label: "Settings", href: "/settings", icon: Settings, roles: O },
    ],
  },
];

export function visibleGroups(role: StaffRole): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) })).filter((g) => g.items.length > 0);
}

export function allLinks(role: StaffRole): NavLink[] {
  return visibleGroups(role).flatMap((g) => g.items);
}

/** Which link is the current page (finance tabs are told apart by ?tab=). */
export function activeKey(links: NavLink[], pathname: string, tab: string | null): string | null {
  for (const l of links) {
    const [path, query] = l.href.split("?");
    if (pathname !== path && !pathname.startsWith(path + "/")) continue;
    if (!query) return l.key;
    const want = new URLSearchParams(query).get("tab");
    if ((tab || "cashbook") === want) return l.key;
  }
  return null;
}

/** Orders and Delivery are the orange edition; every other section is green. */
export function sectionAccent(pathname: string): "green" | "orange" {
  return pathname === "/orders" || pathname.startsWith("/orders/") || pathname === "/delivery" || pathname.startsWith("/delivery/") || pathname === "/my-deliveries" ? "orange" : "green";
}

export function pageTitle(links: NavLink[], key: string | null, pathname: string, fullName?: string): string {
  if (pathname === "/account") return "My account";
  if (pathname === "/notifications") return "Notifications";
  if (key === "dashboard") return greeting(fullName);
  return links.find((l) => l.key === key)?.label ?? "Ravinarayan";
}

/** "Finance › Invoices" for the header trail. */
export function trailFor(groups: NavGroup[], key: string | null, pathname: string): string {
  if (pathname === "/account") return "My account";
  if (pathname === "/notifications") return "Notifications";
  for (const g of groups) {
    const l = g.items.find((i) => i.key === key);
    if (l) return `${g.label} › ${l.label}`;
  }
  return "Ravinarayan";
}
