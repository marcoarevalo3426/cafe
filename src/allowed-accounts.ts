export const adminEmails = [
  "marco.arevalo3426@gmail.com",
  "marevalo@nepgroup.com",
] as const;

export const isAdminEmail = (value: unknown) =>
  typeof value === "string" &&
  adminEmails.some((email) => email === value.trim().toLowerCase());
