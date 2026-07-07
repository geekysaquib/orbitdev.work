import { useEffect, useState } from "react";

export interface Weather { tempC: number; code: number; label: string; emoji: string; }

// WMO weather codes → label + emoji
const MAP: Record<number, [string, string]> = {
  0: ["Clear", "☀️"], 1: ["Mostly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"], 48: ["Fog", "🌫️"], 51: ["Drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Drizzle", "🌦️"],
  61: ["Rain", "🌧️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"], 71: ["Snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Snow", "🌨️"],
  80: ["Showers", "🌦️"], 81: ["Showers", "🌦️"], 82: ["Heavy showers", "⛈️"], 95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm", "⛈️"], 99: ["Thunderstorm", "⛈️"],
};

export function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`);
        const j = await r.json();
        const code = j?.current?.weather_code ?? 0;
        const [label, emoji] = MAP[code] || ["", "🌡️"];
        setWeather({ tempC: Math.round(j?.current?.temperature_2m ?? 0), code, label, emoji });
      } catch { /* ignore */ }
    }, () => { /* denied — skip weather */ }, { timeout: 8000, maximumAge: 30 * 60 * 1000 });
  }, []);
  return weather;
}
