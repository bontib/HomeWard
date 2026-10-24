# SBOM how-to (help panel on "Software on this device")

Static text. The app never runs syft (D5). Built in `web/src/features/devices/SbomHelp.tsx`.

Panel title: **How do I make this file?**

Intro: A software list (called an SBOM) is a file that names the programs on a computer. You make it with a free tool called syft (link to https://github.com/anchore/syft). Open a terminal on that computer and run the two commands for your system. The second one can take a few minutes.

Note (shown under the intro): Scanning the whole disk can take a long time and may need an administrator (Windows) or sudo (Mac, Linux).

| System | 1. Install syft (once) | 2. Make the file |
|--------|------------------------|------------------|
| Windows (PowerShell) | `scoop install syft` | `syft dir:C:\ -o cyclonedx-json=sbom.json` |
| Mac (Terminal) | `brew install syft` | `syft dir:/ -o cyclonedx-json=sbom.json` |
| Linux (terminal) | `brew install syft` | `syft dir:/ -o cyclonedx-json=sbom.json` |

Footer: No scoop or brew? Download syft from its page above. The file sbom.json is saved in the folder you ran the command from. Drop it here when it is done. We only list what syft finds, so some programs may be missing.

Notes
- Flag form `-o cyclonedx-json=FILE` writes CycloneDX JSON to a file (syft v1 syntax).
- Upload hint on the drop zone: "CycloneDX or SPDX file in JSON format, up to 20 MB."
- Commands could not be run here. Please have someone try each once on a real machine before release (Windows `scoop` needs Scoop installed; syft may print warnings for folders it cannot read, that is fine).
- Syft reads files on disk; it does not read the Windows "installed apps" list, so Windows results can be short. The footer says so.
