import { useState } from "react";

export function CsvImportPage() {
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div>
      <h1>Import Contacts (CSV)</h1>
      <p className="hint">
        Upload a CSV, map its columns to contact fields, then confirm the import. Column mapping
        and preview UI are not yet implemented.
      </p>
      <input
        type="file"
        accept=".csv"
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
      />
      {fileName && <p>Selected: {fileName}</p>}
    </div>
  );
}
