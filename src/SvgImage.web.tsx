import React from "react";
import { Image } from "react-native";
export default function SvgImage({
  uri,
  width,
  height,
}: {
  uri: string;
  width: number;
  height: number;
}) {
  return (
    <Image source={{ uri }} style={{ width, height }} resizeMode="contain" />
  );
}
