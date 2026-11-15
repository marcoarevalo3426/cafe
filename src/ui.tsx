import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  Animated,
  AccessibilityInfo,
  Modal,
  ScrollView,
  Platform,
  Image,
  useWindowDimensions,
  type ViewStyle,
  type TextInputProps,
} from "react-native";
import styled from "@emotion/native";
import SvgImage from "./SvgImage";
import { apiBase } from "./platform";
export const colors = {
  ink: "#000000",
  brand: "#2c2c2c",
  background: "#e8e8e8",
  panel: "#d9d9d9",
  line: "#b3b3b3",
  muted: "#757575",
  error: "#b3261e",
  white: "#ffffff",
};
export const Box = styled.View({ gap: 16 });
export const Row = styled.View({
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
});
export const Copy = styled.Text({
  fontSize: 16,
  lineHeight: 22,
  color: "#1e1e1e",
  fontFamily: Platform.OS === "web" ? "Inter, Arial, sans-serif" : "Inter",
});
export const Small = styled(Copy)({
  fontSize: 12,
  lineHeight: 17,
  color: "#757575",
});
export const Heading = styled(Copy)({
  fontSize: 24,
  lineHeight: 29,
  fontWeight: "600",
  fontFamily:
    Platform.OS === "web" ? "Inter, Arial, sans-serif" : "InterSemiBold",
  letterSpacing: -0.48,
  color: "#000",
});
export const Card = styled.View({
  backgroundColor: "#fff",
  borderColor: "#d9d9d9",
  borderWidth: 1,
  borderRadius: 8,
  padding: 24,
  gap: 24,
});
export const Line = styled.View({ height: 1, backgroundColor: "#b3b3b3" });
export const Section = styled.View({ padding: 20, gap: 24 });
export function Btn({
  children,
  onPress,
  outline = false,
  disabled = false,
  small = false,
  style,
  testID,
  label,
}: {
  children: React.ReactNode;
  onPress: () => void;
  outline?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: ViewStyle;
  testID?: string;
  label?: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        testID={testID}
        accessibilityLabel={label}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        onPressIn={() =>
          Animated.spring(scale, {
            toValue: 0.975,
            useNativeDriver: true,
            speed: 40,
          }).start()
        }
        onPressOut={() =>
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: true,
            speed: 40,
          }).start()
        }
        style={({ pressed }) => ({
          minHeight: 44,
          paddingHorizontal: small ? 12 : 16,
          paddingVertical: 12,
          backgroundColor: outline ? "#fff" : "#000",
          borderColor: disabled ? "#b3b3b3" : "#2c2c2c",
          borderWidth: 1,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        })}
      >
        <Copy
          style={{
            color: outline ? "#1e1e1e" : "#f5f5f5",
            textAlign: "center",
          }}
        >
          {children}
        </Copy>
      </Pressable>
    </Animated.View>
  );
}
export function Link({
  children,
  onPress,
  disabled = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: "center",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Copy style={{ textDecorationLine: "underline" }}>{children}</Copy>
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
  style,
  ...rest
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  style?: ViewStyle;
} & Omit<TextInputProps, "onChange" | "value" | "style">) {
  return (
    <Box style={[{ gap: 8 }, style]}>
      {label && <Copy>{label}</Copy>}
      <TextInput
        accessibilityLabel={label ?? placeholder}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#999"
        style={{
          minHeight: 46,
          borderColor: error ? "#b3261e" : "#888",
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 16,
          paddingVertical: 12,
          fontSize: 16,
          lineHeight: 22,
          color: "#1e1e1e",
          backgroundColor: "#fff",
          textAlignVertical: "top",
          ...(Platform.OS === "web"
            ? { fontFamily: "Inter, Arial, sans-serif" }
            : {}),
        }}
        {...rest}
      />
      {error && <ErrorText>{error}</ErrorText>}
    </Box>
  );
}
export const ErrorText = ({ children }: { children: React.ReactNode }) => (
  <Copy
    accessibilityRole="alert"
    style={{ fontSize: 13, lineHeight: 18, color: "#b3261e" }}
  >
    {children}
  </Copy>
);
export function Check({
  checked,
  onPress,
  label,
  hideLabel = false,
  disabled = false,
}: {
  checked: boolean;
  onPress: () => void;
  label?: string;
  hideLabel?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={{
        minWidth: 44,
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <View
        style={{
          width: 30,
          height: 32,
          borderWidth: 2,
          borderColor: "#b3b3b3",
          backgroundColor: checked ? "#2c2c2c" : "#fff",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Copy style={{ color: "white" }}>✓</Copy>}
      </View>
      {label && !hideLabel && <Copy style={{ flex: 1 }}>{label}</Copy>}
    </Pressable>
  );
}
export function Choice({
  selected,
  onPress,
  children,
  disabled = false,
}: {
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 56,
        opacity: disabled ? 0.45 : 1,
        paddingVertical: 12,
        paddingHorizontal: 20,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        borderBottomWidth: 1,
        borderColor: "#d9d9d9",
      }}
    >
      <View style={{ flex: 1 }}>
        <Copy>{children}</Copy>
      </View>
      <View
        style={{
          width: 20,
          height: 20,
          borderWidth: 2,
          borderColor: "#000",
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected && (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: "#000",
            }}
          />
        )}
      </View>
    </Pressable>
  );
}
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  return (
    <Box style={{ gap: 8 }}>
      {label && <Copy>{label}</Copy>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? "Select option"}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen(true)}
        style={{
          minHeight: 46,
          borderWidth: 1,
          borderColor: "#888",
          borderRadius: 8,
          padding: 12,
          backgroundColor: "#fff",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Copy style={{ flex: 1 }}>{chosen?.label ?? "Select"}</Copy>
        <Copy style={{ fontSize: 22 }}>⌄</Copy>
      </Pressable>
      <Dialog
        visible={open}
        title={label ?? "Select an option"}
        onClose={() => setOpen(false)}
      >
        <ScrollView style={{ maxHeight: 380 }}>
          {options.map((o) => (
            <Choice
              key={o.value}
              selected={o.value === value}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </Choice>
          ))}
        </ScrollView>
      </Dialog>
    </Box>
  );
}
export function Circle({
  kind,
  onPress,
  label,
}: {
  kind: "plus" | "minus";
  onPress: () => void;
  label: string;
}) {
  const asset = kind === "plus" ? "29-678-imgIcon.svg" : "circle-minus.svg";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 48,
        height: 48,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Asset
        name={asset}
        width={kind === "plus" ? 47.9999 : 35.9411}
        height={kind === "plus" ? 47.9999 : 35.9411}
      />
    </Pressable>
  );
}
export function Asset({
  name,
  width,
  height,
  style,
}: {
  name: string;
  width: number;
  height: number;
  style?: ViewStyle;
}) {
  const uri = `${apiBase}/design/${name}`;
  return (
    <View style={[{ width, height }, style]}>
      {Platform.OS === "web" || !name.endsWith(".svg") ? (
        <Image
          accessibilityElementsHidden
          source={{ uri }}
          style={{ width, height }}
          resizeMode={name.includes("Line") ? "stretch" : "contain"}
        />
      ) : (
        <SvgImage uri={uri} width={width} height={height} />
      )}
    </View>
  );
}
export function Transition({
  children,
  route,
}: {
  children: React.ReactNode;
  route: string;
}) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!active) return;
      value.setValue(reduce ? 1 : 0);
      Animated.timing(value, {
        toValue: 1,
        duration: reduce ? 0 : 190,
        useNativeDriver: true,
      }).start();
    });
    return () => {
      active = false;
    };
  }, [route]);
  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: value,
        transform: [
          {
            translateX: value.interpolate({
              inputRange: [0, 1],
              outputRange: [12, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
export function Dialog({
  visible,
  title,
  children,
  onClose,
}: {
  visible: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,.35)",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <View
          accessibilityViewIsModal
          aria-modal={true}
          role="dialog"
          style={{
            width: "100%",
            maxWidth: 420,
            maxHeight: "90%",
            backgroundColor: "#fff",
            borderRadius: 10,
            padding: 24,
            gap: 20,
          }}
        >
          <Row>
            <Copy style={{ fontWeight: "600", flex: 1, fontSize: 18 }}>
              {title}
            </Copy>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close dialog"
              onPress={onClose}
              style={{
                minWidth: 44,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Copy style={{ fontSize: 24 }}>×</Copy>
            </Pressable>
          </Row>
          {children}
        </View>
      </View>
    </Modal>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ padding: 24, alignItems: "center" }}>
      <Copy style={{ textAlign: "center" }}>{children}</Copy>
    </View>
  );
}
