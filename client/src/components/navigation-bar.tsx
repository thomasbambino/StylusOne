import { Users, Settings as SettingsIcon, LogOut, Menu, Search } from "lucide-react"
import { Link, useLocation } from "wouter"
import { Settings } from "@shared/schema"
import { motion } from "framer-motion"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { useAuth } from "@/hooks/use-auth"
import { ThemeToggle } from "./theme-toggle"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

interface NavigationBarProps {
  settings?: Settings;
  pageTitle?: string;
}

export function NavigationBar({ settings, pageTitle }: NavigationBarProps) {
  const { user, logoutMutation } = useAuth();
  const [location] = useLocation();
  const isAdmin = user?.role === 'admin';
  const isSuperAdmin = user?.role === 'superadmin';

  // Navigation links
  const navLinks = [
    { href: "/", label: "Dashboard" },
    { href: "/plex", label: "Plex" },
    { href: "/game-servers", label: "Game Servers" },
    { href: "/live-tv", label: "Live TV" },
    { href: "/books", label: "Books" },
  ];

  return (
    <nav 
      className="fixed top-0 left-0 right-0 z-50 w-full max-h-screen"
      style={{
        '--backdrop-filter': 'saturate(180%) brightness(150%) blur(10px)',
        '--bg': 'rgb(from var(--background) r g b / 80%)',
        '--border-color': 'transparent',
        '--shadow': '0 8px 32px rgb(0 0 0 / 12%), 0 2px 8px rgb(0 0 0 / 8%)',
        backdropFilter: 'var(--backdrop-filter)',
        WebkitBackdropFilter: 'var(--backdrop-filter)',
        backgroundColor: 'var(--bg)',
        borderColor: 'var(--border-color)',
        boxShadow: 'var(--shadow)',
      } as React.CSSProperties}
    >
      <div className="max-w-7xl mx-auto">
        <div className="relative flex items-center justify-between h-16 px-6">
          
          {/* Left: Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center space-x-3">
              {settings?.logo_url ? (
                <img
                  src={settings.logo_url}
                  alt="Logo"
                  className="h-6 w-auto"
                />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="24" className="text-foreground">
                  <path d="M 16 0 L 16 8 L 8 8 L 0 0 Z M 0 8 L 8 8 L 16 16 L 8 16 L 8 24 L 0 16 Z" fill="currentColor"/>
                </svg>
              )}
              <span className="text-foreground font-medium text-base">
                {settings?.site_title || "Homelab"}
              </span>
            </Link>
          </div>

          {/* Center: Navigation Links - Absolutely positioned to center */}
          <div className="hidden lg:flex items-center space-x-1 absolute left-1/2 transform -translate-x-1/2">
            {navLinks.map((link) => {
              const isActive = location === link.href;
              return (
                <Link key={link.href} href={link.href}>
                  <motion.button
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-all duration-200 rounded-lg",
                      isActive
                        ? "text-foreground bg-foreground/10"
                        : "text-foreground/80 hover:text-foreground hover:bg-foreground/5"
                    )}
                    whileHover={{ y: -1 }}
                    transition={{ type: "spring", damping: 20, stiffness: 300 }}
                  >
                    {link.label}
                  </motion.button>
                </Link>
              );
            })}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center space-x-3">
            
            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Separator */}
            <div className="w-px h-4 bg-border/50" />

            {/* User Info */}
            <div className="hidden md:block">
              <span className="px-3 py-1.5 text-sm text-foreground/80">
                {user?.username || "Login"}
              </span>
            </div>

            {/* Menu Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <motion.button
                  className="px-4 py-1.5 text-sm font-medium text-primary-foreground bg-primary rounded-full hover:bg-primary/90 transition-colors"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="hidden md:inline">Menu</span>
                  <Menu className="h-4 w-4 md:hidden" />
                </motion.button>
              </DropdownMenuTrigger>
              <DropdownMenuContent 
                align="end" 
                className="w-56 bg-background/95 backdrop-blur-xl border-border/50"
              >
                {/* Admin menu items */}
                {(isAdmin || isSuperAdmin) && (
                  <>
                    <Link href="/users">
                      <DropdownMenuItem className="cursor-pointer">
                        <Users className="h-4 w-4 mr-2" />
                        Users
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/settings">
                      <DropdownMenuItem className="cursor-pointer">
                        <SettingsIcon className="h-4 w-4 mr-2" />
                        Settings
                      </DropdownMenuItem>
                    </Link>
                    <Separator className="my-1" />
                  </>
                )}

                {/* Mobile navigation items */}
                <div className="lg:hidden">
                  {navLinks.map((link) => (
                    <Link key={`mobile-${link.href}`} href={link.href}>
                      <DropdownMenuItem className="cursor-pointer">
                        {link.label}
                      </DropdownMenuItem>
                    </Link>
                  ))}
                  <Separator className="my-1" />
                </div>
                
                <DropdownMenuItem
                  className="cursor-pointer"
                  onSelect={() => logoutMutation.mutate()}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  <span>Logout</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </nav>
  );
}