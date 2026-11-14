import type { Bootstrap, Role } from "./types";
const labels: Record<Role, string> = {
  owner: "Cafe Owner",
  customer: "Customer",
  admin: "Admin",
  organisation: "Organisation",
};
export function accountChoices(data: Pick<Bootstrap, "user" | "accountRoles">) {
  const roles: Role[] =
    data.user && data.accountRoles?.length
      ? data.accountRoles
      : ["owner", "customer", "organisation"];
  return roles.map((role) => ({ role, label: labels[role] }));
}
