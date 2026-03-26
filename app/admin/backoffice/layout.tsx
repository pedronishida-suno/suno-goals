'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Users,
  TrendingUp,
  BookOpen,
  Settings,
  LogOut,
  Menu,
  X,
  UsersRound,
  Bot
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/admin/backoffice', icon: TrendingUp },
  { name: 'Usuários', href: '/admin/backoffice/users', icon: Users },
  { name: 'Times', href: '/admin/backoffice/teams', icon: UsersRound },
  { name: 'Indicadores', href: '/admin/backoffice/indicators', icon: TrendingUp },
  { name: 'Books', href: '/admin/backoffice/books', icon: BookOpen },
  { name: 'AI Terminal', href: '/admin/backoffice/ai-terminal', icon: Bot },
  { name: 'Configurações', href: '/admin/backoffice/settings', icon: Settings },
];

export default function BackofficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-neutral-1">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-neutral-2 transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-neutral-2">
          <Image
            src="/images/Suno Positivo.svg"
            alt="Suno"
            width={100}
            height={33}
            priority
          />
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-2 rounded-lg hover:bg-neutral-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-suno-red text-white'
                    : 'text-neutral-10 hover:bg-neutral-1'
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-neutral-2">
          <button
            onClick={async () => {
              const { createClient } = await import('@/lib/supabase/client');
              const supabase = createClient();
              await supabase.auth.signOut();
              window.location.href = '/login';
            }}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-10 hover:bg-neutral-1 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Sair
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between h-16 px-4 bg-white border-b border-neutral-2">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-neutral-1"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-4 ml-auto">
            <div className="text-right">
              <p className="text-sm font-medium text-neutral-10">Admin FP&A</p>
              <p className="text-xs text-neutral-5">Backoffice</p>
            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

