import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import Link from 'next/link';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-8">
              <Link href="/offers" className="text-xl font-bold text-gray-900">
                AutoGuard
              </Link>
              <nav className="hidden md:flex space-x-6">
                <Link
                  href="/offers"
                  className="text-gray-600 hover:text-gray-900 font-medium"
                >
                  Offers
                </Link>
                <Link
                  href="/pages"
                  className="text-gray-600 hover:text-gray-900 font-medium"
                >
                  Pages
                </Link>
                <Link
                  href="/blacklist"
                  className="text-gray-600 hover:text-gray-900 font-medium"
                >
                  Blacklist
                </Link>
                <Link
                  href="/stats"
                  className="text-gray-600 hover:text-gray-900 font-medium"
                >
                  Statistics
                </Link>
                <Link
                  href="/logs"
                  className="text-gray-600 hover:text-gray-900 font-medium"
                >
                  Logs
                </Link>
                <Link
                  href="/cloak-test"
                  className="text-gray-600 hover:text-gray-900 font-medium"
                >
                  Cloak Test
                </Link>
                <Link
                  href="/settings"
                  className="text-gray-600 hover:text-gray-900 font-medium"
                >
                  Settings
                </Link>
                {user.role === 'admin' ? (
                  <Link
                    href="/admin/queues"
                    className="text-gray-600 hover:text-gray-900 font-medium"
                  >
                    Admin
                  </Link>
                ) : null}
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">{user.email}</span>
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Logout
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
