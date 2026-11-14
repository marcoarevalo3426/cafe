export const apiBase = process.env.APP_BASE_PATH ?? "";
export const loadToken = async () => null;
export const saveToken = async (_token: string | null) => {};
export const nativeHeaders = {};
export const enablePush = async () => {
  throw new Error("Push alerts are available in the iOS and Android app.");
};
export const checkUpdate = async () => {
  throw new Error("The website updates automatically.");
};
export const openLink = async (url: string) => {
  window.location.assign(url);
};
export const externalLink = async (url: string) => {
  window.open(url, "_blank", "noopener,noreferrer");
};
export async function chooseFile(
  accept: string,
): Promise<{ name: string; text: string; data: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      if (file.size > 700000) {
        resolve({ name: file.name, text: "", data: "" });
        return;
      }
      const reader = new FileReader();
      reader.onload = async () =>
        resolve({
          name: file.name,
          text: await file.text(),
          data: String(reader.result),
        });
      reader.readAsDataURL(file);
    };
    input.click();
  });
}
export async function exportJSON(data: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
export const checkoutParams = () => ({
  checkout: new URLSearchParams(location.search).get("checkout"),
  cancelled: new URLSearchParams(location.search).get("cancelled"),
});
export const clearCheckoutParams = () =>
  history.replaceState({}, "", location.pathname);

export const prepareFonts = async () => {};

export const preferredStoreId = process.env.CAFE_STORE_ID ?? "";

export const localTestingClient = () =>
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
