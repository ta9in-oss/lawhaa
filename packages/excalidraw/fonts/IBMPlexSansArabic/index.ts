import { GOOGLE_FONTS_RANGES } from "@excalidraw/common";

import { type ExcalidrawFontFaceDescriptor } from "../Fonts";

import Regular from "./IBMPlexSansArabic-Regular.woff2";

export const IBMPlexSansArabicFontFaces: ExcalidrawFontFaceDescriptor[] = [
  {
    uri: Regular,
    descriptors: {
      unicodeRange: GOOGLE_FONTS_RANGES.ARABIC,
      weight: "400",
    },
  },
];
