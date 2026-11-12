export function parseCafeImport(input: string) {
  if (input.trim().startsWith("[")) {
    const data = JSON.parse(input);
    if (!Array.isArray(data)) throw new Error("Expected an array of cafes.");
    return data;
  }
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && ch === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) throw new Error("Unclosed quote in CSV.");
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  const headers =
    rows.shift()?.map((h) => h.replace(/^\uFEFF/, "").trim()) ?? [];
  if (!headers.includes("name") || !headers.includes("ownerEmail"))
    throw new Error("CSV needs name and ownerEmail headers.");
  return rows.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i]?.trim() ?? ""])),
  );
}
