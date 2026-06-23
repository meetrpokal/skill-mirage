"""Smoke test — test via HTTP endpoint."""
import requests, json, traceback, time

url = "http://localhost:8000/api/chat/"
payload = {
    "query": "hello",
    "user": {
        "username": "Test",
        "user_id": "t1",
        "current_job": "Data Entry",
        "city": "Mumbai",
        "yoe": 2,
        "language": "english",
        "ai_vulnerability_index": 70,
        "short_writeup": "Excel, typing",
    },
}

try:
    t0 = time.time()
    r = requests.post(url, json=payload, timeout=120)
    elapsed = time.time() - t0
    print(f"Status: {r.status_code} ({elapsed:.1f}s)")
    print(f"Body: {r.text[:3000]}")
except Exception:
    traceback.print_exc()
