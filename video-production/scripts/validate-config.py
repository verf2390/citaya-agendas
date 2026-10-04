#!/usr/bin/env python3
import argparse,json,sys
from production import *
p=argparse.ArgumentParser(description='Validate a Citaya video JSON without rendering.')
p.add_argument('--config',required=True);p.add_argument('--mode',choices=MODES,default='preview');p.add_argument('--report');p.add_argument('--normalized')
a=p.parse_args()
try:
 c,r,_=validate(read_json(a.config),a.mode)
 if a.normalized:write_json(a.normalized,c)
 if a.report:write_json(a.report,r)
 print(json.dumps(r,ensure_ascii=False,indent=2))
except ConfigError as e:
 r={'valid':False,'code':e.code,'message':str(e)}
 if a.report:write_json(a.report,r)
 print(json.dumps(r,ensure_ascii=False),file=sys.stderr);sys.exit(2)
