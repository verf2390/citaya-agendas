#!/usr/bin/env python3
"""Inspect and map one local Video Studio project-media folder."""

import argparse
import json
import sys

from media_ingest import MediaIngestError, scan_media, summary, write_manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True, help="Folder inside video-production/inputs/.")
    parser.add_argument("--manifest", help="Optional path where the manifest JSON should be saved.")
    parser.add_argument("--json", action="store_true", help="Print manifest JSON instead of the human summary.")
    args = parser.parse_args()
    manifest = scan_media(args.dir)
    if args.manifest:
        write_manifest(args.manifest, manifest)
    print(json.dumps(manifest, ensure_ascii=False, indent=2) if args.json else summary(manifest))


if __name__ == "__main__":
    try:
        main()
    except MediaIngestError as exc:
        print("MEDIA_INGEST_FAILED [{}]: {}".format(exc.code, exc), file=sys.stderr)
        raise SystemExit(2)
