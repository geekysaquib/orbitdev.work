import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchSettings, saveSettings } from "../lib/settings";

export type ThemeId = "dark" | "midnight" | "light" | "amoled" | "sepia" | "slate" | "solarized" | "cobalt" | "citrus" | "system";

export const THEMES: { id: ThemeId; label: string; desc: string; icon: string }[] = [
  { id: "dark", label: "Graphite", desc: "The original ORBIT dark. Warm greys, mint accent.", icon: "moon" },
  { id: "midnight", label: "Midnight", desc: "Deeper, bluer and near-black — easy on OLED panels.", icon: "moon" },
  { id: "light", label: "Daylight", desc: "Paper-white surfaces with a darkened mint for contrast.", icon: "sun" },
  { id: "amoled", label: "Amoled", desc: "True black surfaces — max contrast and battery savings on OLED.", icon: "moon" },
  { id: "sepia", label: "Sepia", desc: "Warm cream paper tones instead of stark white. Easier on the eyes for long reads.", icon: "sun" },
  { id: "slate", label: "Slate", desc: "A cooler, bluer dark — muted and low-glare.", icon: "moon" },
  { id: "solarized", label: "Solarized", desc: "The classic warm-khaki light palette, developer-favourite.", icon: "sun" },
  { id: "cobalt", label: "Cobalt", desc: "Near-black with blue-tinted surfaces — bold blue accent by default.", icon: "moon" },
  { id: "citrus", label: "Citrus", desc: "Clean white/grayscale surfaces with a vivid orange accent by default.", icon: "sun" },
  { id: "system", label: "Match system", desc: "Follows your OS light/dark preference automatically.", icon: "monitor" },
];

const KEY = "orbit.theme";
const ACCENT_KEY = "orbit.accent";
const CUSTOM_ACCENT_KEY = "orbit.accent.custom";
const FONT_KEY = "orbit.font";
const DENSITY_KEY = "orbit.density";

export type FontId = "grotesk" | "google-sans" | "system" | "mono";
export const FONTS: { id: FontId; label: string; desc: string }[] = [
  { id: "grotesk", label: "Grotesk", desc: "ORBIT's default — Space Grotesk headings, Instrument Sans body." },
  { id: "google-sans", label: "Google Sans", desc: "Google's in-house grotesque — clean and neutral, headings and body both." },
  { id: "system", label: "System", desc: "Your OS's native font. No download, most familiar." },
  { id: "mono", label: "Mono-forward", desc: "JetBrains Mono everywhere — a terminal-flavoured look." },
];

export type DensityId = "comfortable" | "compact";
export const DENSITIES: { id: DensityId; label: string; desc: string }[] = [
  { id: "comfortable", label: "Comfortable", desc: "The default spacing." },
  { id: "compact", label: "Compact", desc: "Tighter padding and gaps — fit more on screen." },
];

/**
 * Preset accent hues. Only `--mint` needs a value per preset — `--mint2` and
 * `--glow` are defined in index.css as color-mix() formulas over var(--mint),
 * so every preset (and the custom hex escape hatch) gets a coherent gradient
 * stop and glow for free without a second hardcoded hue.
 */
export type AccentId = "mint" | "blue" | "violet" | "amber" | "rose" | "custom";
export const ACCENTS: { id: AccentId; label: string; swatch: string }[] = [
  { id: "mint", label: "Mint", swatch: "#37DFA0" },
  { id: "blue", label: "Blue", swatch: "#5B8DEF" },
  { id: "violet", label: "Violet", swatch: "#A98BF5" },
  { id: "amber", label: "Amber", swatch: "#E4A951" },
  { id: "rose", label: "Rose", swatch: "#EA5DA0" },
  { id: "custom", label: "Custom", swatch: "" },
];

function prefersDark(): boolean {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return true; }
}

/** The concrete palette to paint for a (possibly "system") choice. */
export function resolveTheme(t: ThemeId): Exclude<ThemeId, "system"> {
  return t === "system" ? (prefersDark() ? "dark" : "light") : t;
}

function readStored(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.some((t) => t.id === v) ? (v as ThemeId) : "dark";
  } catch { return "dark"; }
}

function readStoredAccent(): AccentId {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return ACCENTS.some((a) => a.id === v) ? (v as AccentId) : "mint";
  } catch { return "mint"; }
}

function readStoredCustomHex(): string {
  try { return localStorage.getItem(CUSTOM_ACCENT_KEY) || "#37DFA0"; } catch { return "#37DFA0"; }
}

function readStoredFont(): FontId {
  try {
    const v = localStorage.getItem(FONT_KEY);
    return FONTS.some((f) => f.id === v) ? (v as FontId) : "grotesk";
  } catch { return "grotesk"; }
}

function readStoredDensity(): DensityId {
  try {
    const v = localStorage.getItem(DENSITY_KEY);
    return DENSITIES.some((d) => d.id === v) ? (v as DensityId) : "comfortable";
  } catch { return "comfortable"; }
}

/** Paints the palette. Exported so index.html's pre-paint script and React agree on one code path. */
export function applyTheme(t: ThemeId) {
  document.documentElement.dataset.theme = resolveTheme(t);
}

/**
 * Paints the accent. Presets are plain `data-accent` attribute values handled
 * by stylesheet rules; "custom" additionally sets `--mint` inline, which wins
 * over any stylesheet rule regardless of theme.
 */
export function applyAccent(a: AccentId, customHex?: string) {
  document.documentElement.dataset.accent = a;
  if (a === "custom") document.documentElement.style.setProperty("--mint", customHex || readStoredCustomHex());
  else document.documentElement.style.removeProperty("--mint");
}

/** Paints the font stack. Same pre-paint-agreement rationale as applyTheme. */
export function applyFont(f: FontId) {
  document.documentElement.dataset.font = f;
}

/** Paints density. Same pre-paint-agreement rationale as applyTheme. */
export function applyDensity(d: DensityId) {
  document.documentElement.dataset.density = d;
}

interface ThemeShape {
  theme: ThemeId; resolved: Exclude<ThemeId, "system">; setTheme: (t: ThemeId) => void;
  accent: AccentId; customAccentHex: string; setAccent: (a: AccentId, customHex?: string) => void;
  font: FontId; setFont: (f: FontId) => void;
  density: DensityId; setDensity: (d: DensityId) => void;
}
const Ctx = createContext<ThemeShape | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readStored);
  // Recomputed on OS changes below so "system" repaints without a reload.
  const [resolved, setResolved] = useState(() => resolveTheme(readStored()));
  const [accent, setAccentState] = useState<AccentId>(readStoredAccent);
  const [customAccentHex, setCustomAccentHex] = useState<string>(readStoredCustomHex);
  const [font, setFontState] = useState<FontId>(readStoredFont);
  const [density, setDensityState] = useState<DensityId>(readStoredDensity);

  // Hydrate from durable settings once — the local value already painted, so this
  // only corrects a device that's behind.
  useEffect(() => {
    fetchSettings().then((s) => {
      if (s.theme && THEMES.some((t) => t.id === s.theme)) setThemeState(s.theme);
      if (s.accent && ACCENTS.some((a) => a.id === s.accent)) setAccentState(s.accent);
      if (s.accent_custom_hex) setCustomAccentHex(s.accent_custom_hex);
      if (s.font && FONTS.some((f) => f.id === s.font)) setFontState(s.font);
      if (s.density && DENSITIES.some((d) => d.id === s.density)) setDensityState(s.density);
    });
  }, []);

  useEffect(() => {
    applyTheme(theme);
    setResolved(resolveTheme(theme));
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { applyTheme("system"); setResolved(resolveTheme("system")); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  useEffect(() => { applyAccent(accent, customAccentHex); }, [accent, customAccentHex]);
  useEffect(() => { applyFont(font); }, [font]);
  useEffect(() => { applyDensity(density); }, [density]);

  const setTheme = (t: ThemeId) => {
    try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
    setThemeState(t);
    saveSettings({ theme: t });
  };

  const setAccent = (a: AccentId, customHex?: string) => {
    try {
      localStorage.setItem(ACCENT_KEY, a);
      if (a === "custom" && customHex) localStorage.setItem(CUSTOM_ACCENT_KEY, customHex);
    } catch { /* ignore */ }
    setAccentState(a);
    if (a === "custom" && customHex) setCustomAccentHex(customHex);
    saveSettings(a === "custom" ? { accent: a, accent_custom_hex: customHex || customAccentHex } : { accent: a });
  };

  const setFont = (f: FontId) => {
    try { localStorage.setItem(FONT_KEY, f); } catch { /* ignore */ }
    setFontState(f);
    saveSettings({ font: f });
  };

  const setDensity = (d: DensityId) => {
    try { localStorage.setItem(DENSITY_KEY, d); } catch { /* ignore */ }
    setDensityState(d);
    saveSettings({ density: d });
  };

  return (
    <Ctx.Provider value={{ theme, resolved, setTheme, accent, customAccentHex, setAccent, font, setFont, density, setDensity }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeShape {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme must be used inside ThemeProvider");
  return c;
}
