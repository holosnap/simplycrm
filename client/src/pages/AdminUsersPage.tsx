import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);

  useEffect(() => {
    api.get<{ users: UserRow[] }>("/users").then((res) => setUsers(res.users));
  }, []);

  return (
    <div>
      <h1>Users</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
