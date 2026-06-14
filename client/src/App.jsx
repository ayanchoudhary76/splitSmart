import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/AppLayout'

const LoginPage      = () => <div className="text-red-500">Login page</div>
const RegisterPage   = () => <div>Register page</div>
const DashboardPage  = () => <div>Dashboard</div>
const GroupPage      = () => <div>Group detail</div>
const ImportPage     = () => <div>Import</div>

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public routes */}
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        
        {/* Protected routes — all inside AppLayout */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/"               element={<DashboardPage />} />
          <Route path="/groups/:id"     element={<GroupPage />} />
          <Route path="/groups/:id/import" element={<ImportPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
