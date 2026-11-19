import { encodeCode128 } from "../../utils/code128.js";

const QUIET_ZONE = 6;

export default function Code128({ value, height = 36, moduleWidth = 1.1 }) {
  if (!value) return null;
  const encoded = encodeCode128(value);
  const totalWidth = encoded.length * moduleWidth;

  let x = QUIET_ZONE;
  const rects = [];
  for (let i = 0; i < encoded.length; i++) {
    let w = 0;
    const bit = encoded[i];
    while (i < encoded.length && encoded[i] === bit) { w++; i++; }
    i--;
    if (bit === "1") {
      rects.push(<rect key={x} x={x} y={0} width={w * moduleWidth} height={height} fill="#000" />);
    }
    x += w * moduleWidth;
  }

  return (
    <div style={{ textAlign: "center" }}>
      <svg xmlns="http://www.w3.org/2000/svg" width={totalWidth + QUIET_ZONE * 2} height={height + 12} style={{ margin: "0 auto" }}>
        <g>{rects}</g>
        <text x={(totalWidth + QUIET_ZONE * 2) / 2} y={height + 10} textAnchor="middle" fontSize="9" fontFamily="monospace" fill="#000">
          {value}
        </text>
      </svg>
    </div>
  );
}
