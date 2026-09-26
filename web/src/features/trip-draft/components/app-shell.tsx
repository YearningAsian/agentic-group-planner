"use client";

/**
 * Sidebar shell for Home, Trips, the planner studio, and older trip screens.
 * Built from the shadcn sidebar; colors stay on the trip-draft tokens.
 * `NAV` is the only sidebar route list. `/studio` highlights Trips. `/plan`, `/progress`, and `/itinerary` highlight nothing here (`ScreenHeader` in `chrome.tsx` covers those).
 */
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Briefcase, CirclePlus, Home } from "lucide-react";
import { AuthControls } from "@/features/auth";
import { DemoLoginPicker } from "@/features/demo";
import { organizerProfile } from "@/features/trip-draft/dashboard-data";
import { initials } from "@/features/trip-draft/format";
import { useTrip } from "@/features/trip-draft/trip-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const NAV = [
  { href: "/", id: "home", label: "Home", icon: Home },
  { href: "/current", id: "current", label: "Current trip", icon: Activity },
  { href: "/onboarding", id: "new", label: "New trip", icon: CirclePlus },
  { href: "/trips", id: "trips", label: "Trips", icon: Briefcase },
] as const;

function activeNav(pathname: string) {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/current")) return "current";
  if (pathname.startsWith("/trips") || pathname.startsWith("/studio")) return "trips";
  if (pathname.startsWith("/onboarding")) return "new";
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const trip = useTrip();
  const { state } = trip;
  const profile = organizerProfile(state);
  const active = activeNav(pathname);
  const flush = pathname.startsWith("/studio");

  return (
    <SidebarProvider
      className="h-dvh max-h-dvh overflow-hidden bg-bg"
      style={{ "--sidebar-width": "260px" } as CSSProperties}
    >
      <Sidebar collapsible="offcanvas" className="border-sidebar-border">
        <SidebarHeader className="px-4 pt-5 pb-2">
          <Link href="/" className="flex items-center gap-2.5 px-2">
            <span className="flex size-[30px] items-center justify-center rounded-md bg-ink text-[15px] font-semibold text-white">
              G
            </span>
            <span className="text-[15px] font-bold tracking-tight text-ink">Group Trip Agent</span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {NAV.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={active === item.id}
                      aria-current={active === item.id ? "page" : undefined}
                      className="h-11 rounded-[11px] px-3 text-[14.5px] font-semibold text-muted hover:bg-bg-muted hover:text-ink data-active:bg-sidebar-accent data-active:text-accent"
                      render={
                        <Link
                          href={item.href}
                          onClick={item.id === "new" ? () => trip.startNewTrip() : undefined}
                        />
                      }
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.id === "trips" && trip.trips.length > 0 ? (
                      <SidebarMenuBadge className="top-3 rounded-full bg-bg-muted px-2 text-[11.5px] font-bold text-muted peer-data-active/menu-button:bg-white peer-data-active/menu-button:text-accent">
                        {trip.trips.length}
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="gap-3 p-4">
          <div className="rounded-[14px] border border-line bg-surface-sunken p-3.5">
            <p className="mb-2.5 text-[12.5px] leading-snug text-muted">
              Have a destination in mind but not much else? Just tell the agent: text, voice, or a quick
              questionnaire.
            </p>
            <Button
              nativeButton={false}
              render={<Link href="/onboarding" onClick={() => trip.startNewTrip()} />}
              className="h-9 w-full rounded-lg bg-ink text-[12.5px] font-semibold text-white hover:bg-[#302a22] active:translate-y-px"
            >
              Start a new trip
            </Button>
          </div>
          <div className="flex items-center gap-2.5 border-t border-sidebar-border pt-3">
            <Avatar className="size-8">
              <AvatarFallback className="bg-[#efd9ce] text-[13px] font-bold text-[#8a4b31]">
                {initials(profile.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13.5px] font-bold text-ink">{profile.name}</p>
              <p className="truncate text-[12px] text-muted">{profile.handle}</p>
            </div>
            <AuthControls className="ml-auto flex shrink-0 items-center gap-1.5" />
          </div>
          <DemoLoginPicker />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-0 overflow-hidden bg-bg">
        <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2 md:hidden">
          <SidebarTrigger className="size-11" />
          <span className="text-sm font-semibold text-ink">Group Trip Agent</span>
          <AuthControls className="ml-auto flex items-center gap-1.5" />
        </div>
        <div className={flush ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "min-h-0 flex-1 overflow-y-auto"}>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
