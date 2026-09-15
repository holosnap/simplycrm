import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Tag {
  id: string;
  name: string;
}

export function AdminSettingsPage() {
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    api.get<{ tags: Tag[] }>("/tags").then((res) => setTags(res.tags));
  }, []);

  return (
    <div>
      <h1>Tags & Custom Fields</h1>
      <section>
        <h2>Tags</h2>
        <ul>
          {tags.map((tag) => (
            <li key={tag.id}>{tag.name}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Custom Fields</h2>
        <p className="hint">Custom field management UI is not yet implemented.</p>
      </section>
    </div>
  );
}
