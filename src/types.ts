export type Role = "owner" | "customer" | "admin";
export interface User {
  id: string;
  email: string;
  role?: Role;
  name: string;
  phone: string;
  storeId?: string;
  orderNotifications: boolean;
  announcements: boolean;
  stripeCustomer?: string;
  disabled?: boolean;
}
export interface Store {
  id: string;
  ownerId: string;
  name: string;
  address: string;
  phone: string;
  currency: string;
  logo: string;
  tier: "free" | "paid";
  subscription: string;
}
export interface Variation {
  id: string;
  name: string;
  amount: number;
}
export interface MenuGroup {
  id: string;
  name: string;
  variations: Variation[];
}
export interface MenuItem {
  id: string;
  storeId: string;
  category: string;
  subcategory: string;
  groups: MenuGroup[];
  template?: boolean;
}
export interface CartLine {
  itemId: string;
  selections: Record<string, string>;
  quantity: number;
  note: string;
}
export interface OrderLine extends CartLine {
  name: string;
  description: string;
  unitAmount: number;
}
export interface Order {
  id: string;
  storeId: string;
  userId: string;
  customer: string;
  lines: OrderLine[];
  total: number;
  voucherAmount: number;
  status: "incoming" | "done";
  createdAt: number;
  completedAt?: number;
  payment: string;
}
export interface Voucher {
  id: string;
  code: string;
  storeId: string;
  balance: number;
  initialAmount: number;
  expiresAt: number;
  email?: string;
  reservedBy?: string;
}
export type VerifiedVoucher = Pick<
  Voucher,
  "id" | "code" | "storeId" | "balance" | "expiresAt"
> & { currency: string };
export interface Feedback {
  id: string;
  userId: string;
  email: string;
  rating: number;
  subject: string;
  message: string;
  createdAt: number;
}
export interface Bootstrap {
  user: User | null;
  accountRoles?: Role[];
  stores: Store[];
  menu: MenuItem[];
  orders: Order[];
  vouchers: Voucher[];
  templates: MenuItem[];
  demo: boolean;
  testingModeAvailable?: boolean;
  testEmailSignInAvailable?: boolean;
  paymentsEnabled: boolean;
  paymentWarning?: string;
  cards: {
    id: string;
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  }[];
  feedback?: Feedback[];
  users?: User[];
  logs?: { id: string; message: string; createdAt: number }[];
  settings?: { subscriptionPrice: number };
  builds?: { id: string; storeId: string; name: string; createdAt: number }[];
}
export const emailValid = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
export const money = (n: number, currency = "AUD") =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(
    n / 100,
  );
export const validity = (n: number) =>
  new Date(n - 1).toLocaleDateString("en-AU", {
    timeZone: "UTC",
    month: "2-digit",
    year: "2-digit",
  });
