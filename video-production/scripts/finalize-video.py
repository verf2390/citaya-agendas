#!/usr/bin/env python3
import argparse
from pathlib import Path
from production import read_json,MODES
from finalize_video import finalize
p=argparse.ArgumentParser(description='Re-bake a poster and verify an existing production output.')
p.add_argument('--output',required=True);a=p.parse_args();out=Path(a.output).resolve();m=read_json(out/'render-metadata.json')
finalize(out/'final.mp4',out/'poster.jpg',MODES[m['mode']],m['duration'],m['posterTime'],out/'media-verification.json')
