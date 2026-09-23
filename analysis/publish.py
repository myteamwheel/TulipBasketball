"""Upload checked files to the existing website, publishing only at completion."""
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.request
import uuid

directory = Path(sys.argv[1])
manifest = json.loads((directory / 'manifest.json').read_text())
if not manifest['freshInputs']: raise RuntimeError('Cached-input builds cannot be published')
token = os.environ['AUDIT_INGEST_TOKEN']
if len(token) < 32: raise RuntimeError('A dedicated audit ingestion token is required')
endpoint = 'https://dynasty-boys-dashboard.vercel.app/api/admin/audit-upload'
upload_id = str(uuid.uuid4())
def send(payload):
    request = urllib.request.Request(endpoint, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token}, method='POST')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=90) as response: result = json.load(response)
            if not result.get('ok'): raise RuntimeError('Website rejected audit upload')
            return result
        except Exception:
            if attempt == 2: raise
            time.sleep(2 ** attempt)
send(dict(action='begin', id=upload_id, manifest=manifest))
for name, info in manifest['files'].items():
    if name not in ('tables.json.gz', 'Dynasty-Bois-Data.xlsx', 'Dynasty-Bois-Report.pdf'): raise RuntimeError('Unexpected output file')
    body = (directory / name).read_bytes()
    if len(body) != info['bytes'] or hashlib.sha256(body).hexdigest() != info['sha256']: raise RuntimeError('Output checksum changed')
    for part, offset in enumerate(range(0, len(body), 512 * 1024)):
        send(dict(action='chunk', id=upload_id, name=name, part=part, body=base64.b64encode(body[offset:offset + 512 * 1024]).decode()))
if not send(dict(action='finish', id=upload_id)).get('complete'): raise RuntimeError('Audit publication did not complete')
print('Published verified audit snapshot', upload_id)
