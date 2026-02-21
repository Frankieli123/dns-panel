import { Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated } from './services/auth';
import { ProviderProvider } from './contexts/ProviderContext';
import Layout from './components/Layout/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import DomainDetail from './pages/DomainDetail';
import CustomHostnames from './pages/CustomHostnames';
import Tunnels from './pages/Tunnels';
import Logs from './pages/Logs';
import Settings from './pages/Settings';

import { BreadcrumbProvider } from './contexts/BreadcrumbContext';

/**
 * 受保护的路由组件
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return (
    <ProviderProvider>
      <BreadcrumbProvider>{children}</BreadcrumbProvider>
    </ProviderProvider>
  );
}

/**
 * 主应用组件
 */
function App() {
  return (
    <Routes>
      {/* 公开路由 */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* 受保护的路由 */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="domain/:zoneId" element={<DomainDetail />} />
        <Route path="hostnames/:zoneId" element={<CustomHostnames />} />
        <Route path="tunnels/:zoneId" element={<Tunnels />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* 404 重定向 */}
      <Route path="*" element={<Navigate to="/?scope=all" replace />} />
    </Routes>
  );
}

export default App;
