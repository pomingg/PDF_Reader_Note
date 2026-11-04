/** Map an RGB colour (0-255) onto the nearest of the four highlighter colours by hue. */
export function colorKeyFromRgb(rgb: ArrayLike<number> | null | undefined): string {
  if (!rgb || rgb.length < 3) return "yellow";
  const [r, g, b] = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08) return "yellow"; // grey / black: no real colour
  let h: number;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  if (h < 20 || h >= 290) return "red";
  if (h < 75) return "yellow";
  if (h < 170) return "green";
  return "blue";
}

const NAMES: Record<string, string> = {
  yellow: "yellow", orange: "yellow", gold: "yellow", 黃: "yellow",
  red: "red", pink: "red", magenta: "red", purple: "red", 紅: "red", 粉: "red",
  green: "green", lime: "green", 綠: "green",
  blue: "blue", cyan: "blue", sky: "blue", 藍: "blue",
};

/** Best-effort colour from whatever another app stores: "#ffeb3b", "rgb(…)", "yellow", 0xffeb3b… */
export function colorKeyFromAny(value: unknown): string {
  if (value == null || value === "") return "yellow";
  if (typeof value === "number" && Number.isFinite(value) && value > 15) {
    return colorKeyFromRgb([(value >> 16) & 255, (value >> 8) & 255, value & 255]);
  }
  const s = String(value).trim().toLowerCase();
  const hex = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return colorKeyFromRgb([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  }
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  if (rgb) return colorKeyFromRgb([+rgb[1], +rgb[2], +rgb[3]]);
  for (const [name, key] of Object.entries(NAMES)) if (s.includes(name)) return key;
  return "yellow";
}
