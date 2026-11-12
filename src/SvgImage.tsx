import React from "react";
import { SvgUri } from "react-native-svg";
export default function SvgImage({
  uri,
  width,
  height,
}: {
  uri: string;
  width: number;
  height: number;
}) {
  return <SvgUri uri={uri} width={width} height={height} />;
}
