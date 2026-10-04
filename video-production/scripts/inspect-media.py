#!/usr/bin/env python3
import argparse,json
from production import ROOT,asset,inspect_media
p=argparse.ArgumentParser();p.add_argument('--path',required=True);p.add_argument('--type',choices=['image','video','audio'],required=True);a=p.parse_args()
print(json.dumps(inspect_media(ROOT/asset(a.path,a.type)),indent=2))
