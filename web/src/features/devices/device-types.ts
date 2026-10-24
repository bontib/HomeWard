import type { DeviceType } from "@/lib/contracts";

export type DeviceTypeInfo = {
  label: string;
  paths: string[];
  /** Where to find the version, as one plain sentence (static help, plan section 9). */
  versionHelp: string;
};

export const DEVICE_TYPES: Record<DeviceType, DeviceTypeInfo> = {
  CONSOLE: {
    label: "Game console",
    paths: [
      "M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6L14 15h-4l-1 .6A4 4 0 0 1 2 13v-1a4 4 0 0 1 4-4z",
      "M7 11v3",
      "M5.5 12.5h3",
      "M16 12h.01",
      "M18 13.5h.01",
    ],
    versionHelp: "Open Settings, then System, then System software or Console information.",
  },
  PC: {
    label: "PC",
    paths: ["M3 4h18v12H3z", "M8 20h8", "M12 16v4"],
    versionHelp:
      "On Windows open Settings, then System, then About. On Mac choose the Apple menu, then About This Mac.",
  },
  LAPTOP: {
    label: "Laptop",
    paths: ["M5 5h14v10H5z", "M2 19h20"],
    versionHelp:
      "On Windows open Settings, then System, then About. On Mac choose the Apple menu, then About This Mac.",
  },
  PHONE: {
    label: "Phone",
    paths: ["M7 2h10v20H7z", "M11 18h2"],
    versionHelp: "Open Settings, then About phone (Android) or General, then About (iPhone).",
  },
  TABLET: {
    label: "Tablet",
    paths: ["M4 3h16v18H4z", "M11 18h2"],
    versionHelp: "Open Settings, then About tablet (Android) or General, then About (iPad).",
  },
  TV: {
    label: "TV",
    paths: ["M2 5h20v13H2z", "M8 21h8"],
    versionHelp:
      "Open Settings, then Support or About this TV, then Software update or Software version.",
  },
  SPEAKER: {
    label: "Smart speaker",
    paths: ["M6 2h12v20H6z", "M12 14m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M12 6h.01"],
    versionHelp:
      "Open the speaker's app, tap the speaker, then Settings and About or Device information.",
  },
  CAMERA: {
    label: "Camera",
    paths: [
      "M12 10m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0",
      "M12 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
      "M8 21h8",
      "M12 16v5",
    ],
    versionHelp: "Open the camera's app, tap the camera, then Settings, Device info and Firmware.",
  },
  PLUG: {
    label: "Smart plug",
    paths: ["M9 2v5", "M15 2v5", "M6 7h12v4a6 6 0 0 1-12 0z", "M12 17v5"],
    versionHelp: "Open the plug's app, tap the plug, then Settings and Device info or Firmware.",
  },
  BULB: {
    label: "Smart light",
    paths: [
      "M9 18h6",
      "M10 22h4",
      "M12 2a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5v1h6v-1c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 2z",
    ],
    versionHelp:
      "Open the light's app (or its hub's app), then Settings and Software update or About.",
  },
  THERMOSTAT: {
    label: "Thermostat",
    paths: [
      "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
      "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
      "M12 8v4",
    ],
    versionHelp: "Open the thermostat's app or menu, then Settings and About or Device info.",
  },
  ROUTER: {
    label: "Router",
    paths: ["M3 14h18v6H3z", "M7 17h.01", "M11 17h.01", "M7 14l-2-6", "M17 14l2-6"],
    versionHelp:
      "Open the router's web page (often 192.168.0.1 or 192.168.1.1), then System or Firmware.",
  },
  DOORBELL: {
    label: "Doorbell",
    paths: [
      "M8 2h8v20H8z",
      "M12 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
      "M12 16m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
    ],
    versionHelp:
      "Open the doorbell's app, tap the doorbell, then Settings, Device info and Firmware.",
  },
  PRINTER: {
    label: "Printer",
    paths: ["M6 9V3h12v6", "M3 9h18v8H3z", "M7 14h10v7H7z"],
    versionHelp: "Open the printer's menu or web page and look for Firmware, Software or About.",
  },
  NAS: {
    label: "NAS",
    paths: ["M4 4h16v6H4z", "M4 14h16v6H4z", "M8 7h.01", "M8 17h.01"],
    versionHelp: "Open the NAS control panel and look for About or System information.",
  },
  OTHER: {
    label: "Other",
    paths: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M8 12h.01", "M12 12h.01", "M16 12h.01"],
    versionHelp:
      "Look in the device's settings or app for About, Device info, Firmware or Software version.",
  },
};

/** Order in the picker. */
export const DEVICE_TYPE_ORDER: DeviceType[] = [
  "CONSOLE",
  "PC",
  "LAPTOP",
  "TV",
  "PHONE",
  "TABLET",
  "SPEAKER",
  "CAMERA",
  "BULB",
  "PLUG",
  "THERMOSTAT",
  "ROUTER",
  "DOORBELL",
  "PRINTER",
  "NAS",
  "OTHER",
];

/** Groups for the chips on My home (backlog P3-3, decision D10). */
export const DEVICE_GROUPS = {
  consoles: ["CONSOLE"],
  media: ["TV", "SPEAKER"],
  computers: ["PC", "LAPTOP"],
  smartHome: ["CAMERA", "PLUG", "BULB", "THERMOSTAT", "DOORBELL"],
} as const satisfies Record<string, readonly DeviceType[]>;
