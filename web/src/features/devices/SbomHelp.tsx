import { Disclosure } from "@/components/ui/Disclosure";

const SYFT_URL = "https://github.com/anchore/syft";

function Command({ children }: { children: string }) {
  return (
    <pre className="rounded-field bg-surface-100 m-0 overflow-x-auto p-3 font-mono text-[13px] leading-[18px]">
      <code>{children}</code>
    </pre>
  );
}

function Step({ title, install, run }: { title: string; install: string; run: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="t-label">{title}</p>
      <p className="t-caption">1. Install syft (once)</p>
      <Command>{install}</Command>
      <p className="t-caption">2. Make the file</p>
      <Command>{run}</Command>
    </div>
  );
}

/** Static help. The app never runs syft itself (decision D5). Wording: docs/design/sbom-howto.md. */
export function SbomHelp() {
  return (
    <Disclosure summary="How do I make this file?">
      <div className="flex flex-col gap-4">
        <p>
          A software list (called an SBOM) is a file that names the programs on a computer. You make
          it with a free tool called{" "}
          <a href={SYFT_URL} target="_blank" rel="noopener noreferrer">
            syft
          </a>
          . Open a terminal on that computer and run the two commands for your system. The second
          one can take a few minutes.
        </p>
        <Step
          title="Windows (open PowerShell)"
          install="scoop install syft"
          run={"syft dir:C:\\ -o cyclonedx-json=sbom.json"}
        />
        <Step
          title="Mac (open Terminal)"
          install="brew install syft"
          run="syft dir:/ -o cyclonedx-json=sbom.json"
        />
        <Step
          title="Linux (open a terminal)"
          install="brew install syft"
          run="syft dir:/ -o cyclonedx-json=sbom.json"
        />
        <p className="t-caption">
          No scoop or brew? Download syft from its page above. The file sbom.json is saved in the
          folder you ran the command from. Drop it here when it is done. We only list what syft
          finds, so some programs may be missing.
        </p>
      </div>
    </Disclosure>
  );
}
