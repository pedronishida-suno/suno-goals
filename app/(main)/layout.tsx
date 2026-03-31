'use client';

import { useState, useEffect } from 'react';
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
  Bot,
  Home,
  ChevronDown
} from 'lucide-react';

const navigation = [
  { name: 'Meu Book', href: '/', icon: Home },
  { name: 'Dashboard', href: '/admin/backoffice', icon: TrendingUp },
  { name: 'Usuários', href: '/admin/backoffice/users', icon: Users },
  { name: 'Times', href: '/admin/backoffice/teams', icon: UsersRound },
  { name: 'Indicadores', href: '/admin/backoffice/indicators', icon: TrendingUp },
  { name: 'Books', href: '/admin/backoffice/books', icon: BookOpen },
  { name: 'AI Terminal', href: '/admin/backoffice/ai-terminal', icon: Bot },
  { name: 'Configurações', href: '/admin/backoffice/settings', icon: Settings },
];

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [userName, setUserName] = useState('Admin');
  const pathname = usePathname();

  useEffect(() => {
    import('@/lib/supabase/client').then(({ createClient }) => {
      createClient().auth.getUser().then(({ data }) => {
        if (data.user?.email) setUserName(data.user.email.split('@')[0]);
      });
    });
  }, []);

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
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-neutral-2 flex flex-col transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${
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
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
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

          <div className="relative flex items-center gap-4 ml-auto">
            <button 
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex items-center gap-2 hover:bg-neutral-1 p-2 rounded-lg transition-colors cursor-pointer"
            >
              <div className="text-right">
                <p className="text-sm font-medium text-neutral-10">{userName}</p>
                <p className="text-xs text-neutral-5">Admin · FP&A</p>
              </div>
              <ChevronDown className="w-4 h-4 text-neutral-5" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-neutral-2 rounded-lg shadow-lg py-1 z-50">
                <div className="px-4 py-2 border-b border-neutral-2">
                  <p className="text-sm font-medium text-neutral-10">{userName}</p>
                  <p className="text-xs text-neutral-5">Admin</p>
                </div>
                <button
                  onClick={async () => {
                    const { createClient } = await import('@/lib/supabase/client');
                    const supabase = createClient();
                    await supabase.auth.signOut();
                    window.location.href = '/login';
                  }}
                  className="flex items-center gap-3 w-full px-4 py-2 text-sm font-medium text-suno-red hover:bg-neutral-1 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sair da conta
                </button>
              </div>
            )}
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

