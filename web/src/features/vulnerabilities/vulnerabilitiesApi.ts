import type {
  AffectedDevice,
  FindingRow,
  FindingState,
  RiskLevel,
  VulnerabilityDetail,
} from "@/lib/contracts";
import { api } from "@/store/api";

export type VulnerabilityListArgs = { deviceId?: string; level?: RiskLevel; state?: FindingState };

function toQuery(args: VulnerabilityListArgs): string {
  const params = new URLSearchParams();
  if (args.deviceId) params.set("deviceId", args.deviceId);
  if (args.level) params.set("level", args.level);
  if (args.state) params.set("state", args.state);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const vulnerabilitiesApi = api.injectEndpoints({
  endpoints: (build) => ({
    listVulnerabilities: build.query<
      { findings: FindingRow[]; notFullyCheckedDeviceCount: number },
      VulnerabilityListArgs
    >({
      query: (args) => `vulnerabilities${toQuery(args)}`,
      providesTags: ["Findings"],
    }),
    getVulnerability: build.query<
      { vulnerability: VulnerabilityDetail; affected: AffectedDevice[] },
      string
    >({
      query: (cveId) => `vulnerabilities/${encodeURIComponent(cveId)}`,
      providesTags: (_r, _e, cveId) => [{ type: "Vulnerability", id: cveId }],
    }),
  }),
});

export const { useListVulnerabilitiesQuery, useGetVulnerabilityQuery } = vulnerabilitiesApi;
