import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import PageEnConstruction from './pages/PageEnConstruction'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            {/* Pages communes aux deux rôles */}
            <Route path="/" element={<PageEnConstruction />} />
            <Route path="/notifications" element={<PageEnConstruction />} />
            <Route path="/edt" element={<PageEnConstruction />} />
            <Route path="/salles" element={<PageEnConstruction />} />
            <Route path="/reservations" element={<PageEnConstruction />} />
            <Route path="/demandes" element={<PageEnConstruction />} />

            {/* Pages réservées à l'admin */}
            <Route
              element={
                <ProtectedRoute roles={['admin']}>
                  <Outlet />
                </ProtectedRoute>
              }
            >
              <Route path="/creneaux" element={<PageEnConstruction />} />
              <Route path="/evenements" element={<PageEnConstruction />} />
              <Route path="/conflits" element={<PageEnConstruction />} />
              <Route path="/niveaux" element={<PageEnConstruction />} />
              <Route path="/filieres" element={<PageEnConstruction />} />
              <Route path="/groupes" element={<PageEnConstruction />} />
              <Route path="/modules" element={<PageEnConstruction />} />
              <Route path="/utilisateurs" element={<PageEnConstruction />} />
              <Route path="/historique" element={<PageEnConstruction />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}