import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface TaskItem {
  id: string;
  title: string;
  status: "open" | "done";
  dueAt: string | null;
  contact: { id: string; firstName: string; lastName: string } | null;
}

export function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [filter, setFilter] = useState<"open" | "done" | "">("open");

  function refresh() {
    const params = filter ? `?status=${filter}` : "";
    api.get<{ tasks: TaskItem[] }>(`/tasks${params}`).then((res) => setTasks(res.tasks));
  }

  useEffect(refresh, [filter]);

  async function toggleDone(task: TaskItem) {
    await api.patch(`/tasks/${task.id}`, { status: task.status === "open" ? "done" : "open" });
    refresh();
  }

  return (
    <div>
      <header className="page-header">
        <h1>Tasks</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="open">Open</option>
          <option value="done">Done</option>
          <option value="">All</option>
        </select>
      </header>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <label>
              <input
                type="checkbox"
                checked={task.status === "done"}
                onChange={() => toggleDone(task)}
              />
              {task.title}
              {task.contact && ` — ${task.contact.firstName} ${task.contact.lastName}`}
              {task.dueAt && ` (due ${new Date(task.dueAt).toLocaleDateString()})`}
            </label>
          </li>
        ))}
        {tasks.length === 0 && <li>No tasks.</li>}
      </ul>
    </div>
  );
}
