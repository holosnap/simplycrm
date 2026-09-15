import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function Layout() {
  const { user, loading, logout } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">SimplyCRM</div>
        <NavLink to="/contacts">Contacts</NavLink>
        <NavLink to="/companies">Companies</NavLink>
        <NavLink to="/deals">Deals</NavLink>
        <NavLink to="/tasks">Tasks</NavLink>
        {user.role === "admin" && <NavLink to="/admin/users">Users</NavLink>}
        {user.role === "admin" && <NavLink to="/admin/settings">Tags & Fields</NavLink>}
        <NavLink to="/account">My Account</NavLink>
        <button onClick={logout}>Log out</button>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
