// Fixtures typed with contract types. Used by component tests and the /ui page.
import type {
  DeviceDetail,
  DeviceFinding,
  DeviceSummary,
  VulnerabilitySummary,
} from "@/lib/contracts";

const NOW = "2026-03-12T10:00:00.000Z";

export function makeDevice(overrides: Partial<DeviceSummary> = {}): DeviceSummary {
  return {
    id: "dev_1",
    name: "Front door camera",
    type: "CAMERA",
    room: "Front door",
    product: {
      componentId: "cmp_1",
      name: "E1 Outdoor",
      vendor: "Reolink",
      cpe: "cpe:2.3:o:reolink:e1_outdoor_firmware",
      version: "3.1.0",
      check: "CHECKED",
    },
    status: "CRITICAL",
    check: { state: "IDLE", jobId: null, errorCode: null },
    targetVersion: "3.1.2",
    openFindingCount: 2,
    componentCount: 1,
    uncheckedCount: 0,
    hasSbom: false,
    lastCheckedAt: NOW,
    ...overrides,
  };
}

export const criticalCamera = makeDevice();

export const vulnerableConsole = makeDevice({
  id: "dev_2",
  name: "Living room PlayStation",
  type: "CONSOLE",
  room: "Living room",
  status: "VULNERABLE",
  targetVersion: "25.02",
  openFindingCount: 1,
  product: {
    componentId: "cmp_2",
    name: "PlayStation 5",
    vendor: "Sony",
    cpe: "cpe:2.3:o:sony:playstation_5_firmware",
    version: "24.06",
    check: "CHECKED",
  },
});

export const cleanLaptop = makeDevice({
  id: "dev_3",
  name: "Bon's laptop",
  type: "LAPTOP",
  room: "Study",
  status: "NO_KNOWN_VULNS",
  targetVersion: null,
  openFindingCount: 0,
  uncheckedCount: 3,
  componentCount: 40,
  hasSbom: true,
  product: null,
});

export const untrackedPrinter = makeDevice({
  id: "dev_4",
  name: "Study printer",
  type: "PRINTER",
  room: "Study",
  status: "NOT_TRACKED",
  targetVersion: null,
  openFindingCount: 0,
  lastCheckedAt: null,
  product: {
    componentId: "cmp_4",
    name: "OfficeJet",
    vendor: null,
    cpe: null,
    version: null,
    check: "NO_IDENTIFIER",
  },
});

export const checkingTv = makeDevice({
  id: "dev_5",
  name: "Living room TV",
  type: "TV",
  status: "PENDING",
  targetVersion: null,
  openFindingCount: 0,
  lastCheckedAt: null,
  check: { state: "CHECKING", jobId: "job_1", errorCode: null },
});

export const allStatusDevices: DeviceSummary[] = [
  criticalCamera,
  vulnerableConsole,
  cleanLaptop,
  untrackedPrinter,
  checkingTv,
];

export const criticalVulnerability: VulnerabilitySummary = {
  id: "CVE-2026-10231",
  severity: "CRITICAL",
  cvssScore: 9.8,
  exploited: true,
  summary:
    "A flaw in the camera's web page lets another device on the network open the live video without a password. Attackers are already using this. More detail follows here.",
  publishedAt: "2026-02-01T00:00:00.000Z",
  nvdUrl: "https://nvd.nist.gov/vuln/detail/CVE-2026-10231",
};

export const mediumVulnerability: VulnerabilitySummary = {
  id: "CVE-2026-10388",
  severity: "MEDIUM",
  cvssScore: 6.5,
  exploited: false,
  summary: "Another device can make the camera restart again and again.",
  publishedAt: "2026-02-10T00:00:00.000Z",
  nvdUrl: "https://nvd.nist.gov/vuln/detail/CVE-2026-10388",
};

export const lowVulnerability: VulnerabilitySummary = {
  id: "CVE-2026-20001",
  severity: "LOW",
  cvssScore: 2.1,
  exploited: false,
  summary: "A minor information leak.",
  publishedAt: null,
  nvdUrl: "https://nvd.nist.gov/vuln/detail/CVE-2026-20001",
};

export function makeFinding(
  vulnerability: VulnerabilitySummary,
  overrides: Partial<DeviceFinding> = {},
): DeviceFinding {
  return {
    id: `fnd_${vulnerability.id}`,
    state: "OPEN",
    ignoredReason: null,
    fixedVersion: "3.1.2",
    source: "NVD",
    firstSeenAt: NOW,
    component: { id: "cmp_1", name: "E1 Outdoor", version: "3.1.0" },
    vulnerability,
    ...overrides,
  };
}

export const criticalFinding = makeFinding(criticalVulnerability);
export const mediumFinding = makeFinding(mediumVulnerability, { fixedVersion: "3.1.1" });

export const cameraDetail: DeviceDetail = {
  ...criticalCamera,
  notes: null,
  createdAt: "2026-03-12T09:00:00.000Z",
  findings: [criticalFinding, mediumFinding],
  versionHistory: [
    { id: "vh_1", fromVersion: "3.0.4", toVersion: "3.1.0", changedAt: "2026-06-02T00:00:00.000Z" },
  ],
  sbom: null,
};
