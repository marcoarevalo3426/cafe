export const isOrderName = (value: unknown): value is string =>
  typeof value === "string" && /^\p{L}{1,20}$/u.test(value);

export const cleanOrderName = (value: string) =>
  Array.from(value.replace(/[^\p{L}]/gu, ""))
    .slice(0, 20)
    .join("");
