// Admin layout — auth is enforced by middleware.ts (role check for /admin/* routes)
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
