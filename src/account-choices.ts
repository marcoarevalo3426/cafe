import type { Bootstrap, Role } from "./types";
const labels: Record<Role, string> = {
  owner: "Cafe Owner",
  customer: "Customer",
  admin: "Admin",
};
export function accountChoices(data: Pick<Bootstrap, "user" | "accountRoles">) {
  const roles: Role[] =
    data.user && data.accountRoles?.length
      ? data.accountRoles
      : ["owner", "customer"];
  return roles.map((role) => ({ role, label: labels[role] }));
}

export function testingAccountChoices(
  data: Pick<Bootstrap, "user" | "accountRoles">,
) {
  const choices: { role: Role; label: string }[] = [
    { role: "customer", label: "Customer" },
    { role: "owner", label: "Cafe owner" },
  ];
  if (data.user && data.accountRoles?.includes("admin"))
    choices.push({ role: "admin", label: "Admin" });
  return choices;
}
