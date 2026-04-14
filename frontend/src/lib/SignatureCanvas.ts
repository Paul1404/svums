// CJS interop: Vite 8/Rolldown may wrap the CJS module so the default import
// is a namespace object { default: Component } instead of the component itself.
import SignatureCanvasType from "react-signature-canvas";

const SignatureCanvas: typeof SignatureCanvasType =
  typeof SignatureCanvasType === "function"
    ? SignatureCanvasType
    : (SignatureCanvasType as unknown as { default: typeof SignatureCanvasType })
        .default;

export default SignatureCanvas;
export type { default as SignatureCanvasType } from "react-signature-canvas";
