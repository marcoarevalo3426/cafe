import type { ExpoConfig } from "expo/config";
const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
const config: ExpoConfig = {
  name: process.env.APP_NAME ?? "NEP Cafe Vouchers",
  slug: process.env.APP_SLUG ?? "cafe",
  version: "0.1.0",
  scheme: process.env.APP_SCHEME ?? "cafe",
  orientation: "default",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: process.env.IOS_BUNDLE_ID ?? "com.example.cafe",
    supportsTablet: true,
  },
  android: {
    package: process.env.ANDROID_PACKAGE ?? "com.example.cafe",
    ...(process.env.GOOGLE_SERVICES_FILE
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_FILE }
      : {}),
  },
  plugins: [
    "expo-secure-store",
    "expo-font",
    [
      "expo-notifications",
      { defaultChannel: "orders", enableBackgroundRemoteNotifications: true },
    ],
    ["expo-image-picker", { photosPermission: "Choose a logo for your cafe." }],
    "expo-document-picker",
  ],
  runtimeVersion: { policy: "fingerprint" },
  updates: {
    enabled: !!projectId,
    ...(projectId ? { url: `https://u.expo.dev/${projectId}` } : {}),
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000",
    storeId: process.env.CAFE_STORE_ID,
    ...(projectId ? { eas: { projectId } } : {}),
  },
};
export default config;
