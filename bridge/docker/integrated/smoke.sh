#!/bin/sh
set -eu
image=${STACK_IMAGE:-picpeak-pixcake:3.134.1-zh.26-bridge.0.1.12}
name=picpeak-integrated-smoke
cleanup() { docker rm -fv "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker run -d --platform linux/amd64 --name "$name" -e BRIDGE_ENABLED=true -e PICPEAK_TOKEN=pp_live_integration_fixture -e BRIDGE_ADMIN_PASSWORD=integration-fixture-password "$image" >/dev/null
ready=false
for attempt in $(seq 1 90); do
 if docker exec "$name" /opt/bridge/venv/bin/python /opt/integrated/health.py >/dev/null 2>&1; then ready=true; break; fi
 sleep 2
done
if [ "$ready" != true ]; then docker logs "$name"; exit 1; fi
docker exec "$name" /opt/bridge/venv/bin/python -c 'import sys; assert sys.version_info[:2] == (3,12)'
docker exec "$name" /opt/bridge/venv/bin/python -c 'from pathlib import Path; assert Path("/data/db/picpeak.db").exists(); assert Path("/bridge-data/bridge.db").exists(); Path("/bridge-data/restart-proof").write_text("persisted")'
docker exec "$name" supervisorctl -c /opt/integrated/supervisord.conf status
docker exec "$name" supervisorctl -c /opt/integrated/supervisord.conf signal KILL bridge
sleep 8
docker exec "$name" /opt/bridge/venv/bin/python /opt/integrated/health.py
docker exec -i "$name" /opt/bridge/venv/bin/python - <<'PYTHON'
import base64, json, urllib.request, uuid
headers = {'Authorization': 'Basic ' + base64.b64encode(b'admin:integration-fixture-password').decode(), 'Content-Type': 'application/json'}
def call(path, body=None):
    request = urllib.request.Request('http://127.0.0.1:8080/api/state/' + path, headers=headers,
                                    data=json.dumps(body).encode() if body is not None else None)
    return json.load(urllib.request.urlopen(request, timeout=5))
saved = call('checkpoint', {'token': str(uuid.uuid4()), 'purpose': 'restore'})
assert call('activate', {'token': saved['token']})['success']
assert call('status')['blocked']
PYTHON
docker restart "$name" >/dev/null
ready=false
for attempt in $(seq 1 60); do
 if docker exec "$name" /opt/bridge/venv/bin/python /opt/integrated/health.py >/dev/null 2>&1; then ready=true; break; fi
 sleep 2
done
[ "$ready" = true ]
docker exec "$name" /opt/bridge/venv/bin/python -c 'from pathlib import Path; assert Path("/bridge-data/restart-proof").read_text() == "persisted"'
docker exec -i "$name" /opt/bridge/venv/bin/python - <<'PYTHON'
import base64, json, urllib.request, uuid
headers = {'Authorization': 'Basic ' + base64.b64encode(b'admin:integration-fixture-password').decode(), 'Content-Type': 'application/json'}
def call(path, body=None):
    request = urllib.request.Request('http://127.0.0.1:8080/api/state/' + path, headers=headers,
                                    data=json.dumps(body).encode() if body is not None else None)
    return json.load(urllib.request.urlopen(request, timeout=5))
status = call('status')
assert status['blocked'] and '正在恢复' in status['reason']
assert call('renew', {'token': status['token']})['success']
assert call('block', {'token': status['token'], 'reason': '恢复暂停重启验证'})['success']
assert call('release', {'token': status['token']})['success']
assert not call('status')['blocked']
PYTHON
echo 'Integrated two-service boot, Python 3.12, state, process recovery, in-progress recovery checkpoint and container restart passed.'
cleanup
docker run -d --platform linux/amd64 --name "$name" "$image" >/dev/null
ready=false
for attempt in $(seq 1 60); do
 if docker exec "$name" /opt/bridge/venv/bin/python /opt/integrated/health.py >/dev/null 2>&1; then ready=true; break; fi
 sleep 2
done
[ "$ready" = true ]
docker exec "$name" /opt/bridge/venv/bin/python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:3000/api/setup/status", timeout=3)'
echo 'Fresh initialization without API Token passed.'
