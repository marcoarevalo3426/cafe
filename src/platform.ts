import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { Linking, Platform, Share } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Font from "expo-font";
export const apiBase =
  Constants.expoConfig?.extra?.apiUrl ?? "http://localhost:4000";
export const loadToken = () => SecureStore.getItemAsync("cafe-session");
export const saveToken = (token: string | null) =>
  token
    ? SecureStore.setItemAsync("cafe-session", token)
    : SecureStore.deleteItemAsync("cafe-session");
export const nativeHeaders = { "X-Cafe-Client": "native" };
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});
export async function enablePush() {
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("orders", {
      name: "Orders",
      importance: Notifications.AndroidImportance.HIGH,
    });
  const current = await Notifications.getPermissionsAsync();
  const permission =
    current.status === "granted"
      ? current
      : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error("Notifications are disabled in your device settings.");
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId)
    throw new Error(
      "Configure the Expo project ID to enable device notifications.",
    );
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}
export async function checkUpdate() {
  if (__DEV__ || !Updates.isEnabled)
    throw new Error("Updates are available in a configured release build.");
  const update = await Updates.checkForUpdateAsync();
  if (!update.isAvailable) return false;
  await Updates.fetchUpdateAsync();
  return true;
}
export const applyUpdate = () => Updates.reloadAsync();
export const openLink = async (url: string) => {
  await Linking.openURL(url);
};
export const externalLink = openLink;
export async function chooseFile(
  accept: string,
): Promise<{ name: string; text: string; data: string } | null> {
  if (accept.startsWith("image/")) {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.6,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled) return null;
    const image = result.assets[0];
    return {
      name: image.fileName ?? "logo.jpg",
      text: "",
      data: `data:${image.mimeType ?? "image/jpeg"};base64,${image.base64 ?? ""}`,
    };
  }
  const result = await DocumentPicker.getDocumentAsync({
    type: ["text/csv", "application/json", "text/plain"],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  if (file.size > 700000) throw new Error("Choose a file smaller than 700 KB.");
  return { name: asset.name, text: await file.text(), data: "" };
}
export const prepareFonts = () =>
  Font.loadAsync({
    Inter: require("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"),
    InterSemiBold: require("@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf"),
    InterBold: require("@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"),
  });
export const exportJSON = async (data: unknown, name: string) => {
  await Share.share({ title: name, message: JSON.stringify(data, null, 2) });
};
let pending: { checkout: string | null; cancelled: string | null } = {
  checkout: null,
  cancelled: null,
};
Linking.addEventListener("url", (event) => {
  try {
    const url = new URL(event.url);
    pending = {
      checkout: url.searchParams.get("checkout"),
      cancelled: url.searchParams.get("cancelled"),
    };
  } catch {}
});
export const checkoutParams = () => pending;
export const clearCheckoutParams = () => {
  pending = { checkout: null, cancelled: null };
};

export const preferredStoreId = Constants.expoConfig?.extra?.storeId ?? "";

export const localTestingClient = () => __DEV__;
