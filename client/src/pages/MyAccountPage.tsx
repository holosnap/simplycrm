import { useAuth } from "../context/AuthContext";

export function MyAccountPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1>My Account</h1>
      <p>Name: {user?.name}</p>
      <p>Email: {user?.email}</p>
      <p className="hint">Change-password form is not yet implemented.</p>
    </div>
  );
}
