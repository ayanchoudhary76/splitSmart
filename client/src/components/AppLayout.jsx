import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex-shrink-0 font-bold text-xl text-brand-primary">
              SplitSmart
            </div>
            <div className="flex items-center gap-8">
              <span className="text-brand-dark font-medium">{user?.name}</span>
              <button
                onClick={handleLogout}
                style={{ background: 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)' }}
                className="px-5 py-2 text-sm font-semibold text-white rounded-xl shadow-sm hover:opacity-90 active:scale-[0.95] transition-all"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}
