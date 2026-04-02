"""
Real Time Event Synchronization Engine
Backend: Flask + Server-Sent Events (SSE)
Run: python app.py
Open: http://localhost:5000
"""

import json
import time
import random
import string
import threading
import queue
from datetime import datetime, timezone
from flask import Flask, Response, request, jsonify, render_template, stream_with_context

app = Flask(__name__)
app.config["SECRET_KEY"] = "rtese-secret-2026"

# ─────────────────────────────────────────────────────────────
# ENGINE STATE
# ─────────────────────────────────────────────────────────────

engine_state = {
    "running": True,
    "seq_id": 98400,
    "total_events": 0,
    "total_errors": 0,
    "start_time": time.time(),
}

event_log = []          # list of event dicts, newest first
MAX_LOG = 1000

topic_counts   = {}
topic_errors   = {}
topic_lat_sum  = {}
topic_lat_cnt  = {}

TOPICS = [
    "order.created", "order.updated", "user.signup",
    "payment.processed", "inventory.update", "notification.push",
]
PRODUCERS = [
    "svc-payment-001", "svc-auth-001", "svc-inventory-001",
    "svc-order-001",   "svc-notify-001",
]
PRIORITIES = ["HIGH", "MEDIUM", "LOW"]

for t in TOPICS:
    topic_counts[t]  = 0
    topic_errors[t]  = 0
    topic_lat_sum[t] = 0.0
    topic_lat_cnt[t] = 0

CONSUMERS = [
    {"id": "cons_a9f3", "service": "svc-dashboard",   "topics": "order.* / user.*",       "proto": "WebSocket", "status": "active",  "lag": 0,   "delivered": 0},
    {"id": "cons_b7e1", "service": "svc-notify",       "topics": "payment.* / user.*",     "proto": "WebSocket", "status": "active",  "lag": 2,   "delivered": 0},
    {"id": "cons_c5d2", "service": "svc-analytics",    "topics": "*.created",              "proto": "REST Poll", "status": "active",  "lag": 0,   "delivered": 0},
    {"id": "cons_d3c4", "service": "svc-billing",      "topics": "payment.processed",      "proto": "Webhook",   "status": "active",  "lag": 0,   "delivered": 0},
    {"id": "cons_e1b5", "service": "svc-inventory",    "topics": "inventory.*",            "proto": "WebSocket", "status": "lagging", "lag": 145, "delivered": 0},
    {"id": "cons_f9a6", "service": "svc-reporting",    "topics": "*.*",                    "proto": "REST Poll", "status": "active",  "lag": 0,   "delivered": 0},
    {"id": "cons_g7c7", "service": "svc-cache",        "topics": "order.*",                "proto": "WebSocket", "status": "lagging", "lag": 31,  "delivered": 0},
    {"id": "cons_i3e9", "service": "svc-search",       "topics": "*.created",              "proto": "WebSocket", "status": "offline", "lag": 0,   "delivered": 0},
]

# SSE subscriber queues
_sse_subscribers = []
_sse_lock = threading.Lock()

# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def rand_id(prefix="evt"):
    chars = string.ascii_lowercase + string.digits
    return prefix + "_" + "".join(random.choices(chars, k=8))

def now_ts():
    return datetime.now().strftime("%H:%M:%S.") + f"{datetime.now().microsecond // 1000:03d}"

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

def make_event(topic=None, producer=None, priority=None, payload=None):
    """Create a new event dict."""
    engine_state["seq_id"] += 1
    engine_state["total_events"] += 1

    t   = topic    or random.choice(TOPICS)
    p   = producer or random.choice(PRODUCERS)
    pri = priority or random.choice(PRIORITIES)
    lat = round(random.uniform(0.8, 3.4), 1)
    is_err = random.random() < 0.012

    if is_err:
        engine_state["total_errors"] += 1
        topic_errors[t] = topic_errors.get(t, 0) + 1

    topic_counts[t]  = topic_counts.get(t, 0) + 1
    topic_lat_sum[t] = topic_lat_sum.get(t, 0.0) + lat
    topic_lat_cnt[t] = topic_lat_cnt.get(t, 0) + 1

    ev = {
        "seqId":     engine_state["seq_id"],
        "id":        rand_id("evt"),
        "topic":     t,
        "producer":  p,
        "priority":  pri,
        "timestamp": now_ts(),
        "isoTime":   now_iso(),
        "status":    "NACK" if is_err else "ACK",
        "latency":   lat,
        "consumers": random.randint(2, len(CONSUMERS) - 1),
        "payload":   payload or _sample_payload(t),
    }

    event_log.insert(0, ev)
    if len(event_log) > MAX_LOG:
        event_log.pop()

    _update_consumers(ev)
    return ev

def _sample_payload(topic):
    if topic.startswith("order"):
        return {"orderId": "ORD-" + str(random.randint(10000, 99999)),
                "amount": round(random.uniform(100, 9999), 2),
                "currency": "INR"}
    if topic.startswith("user"):
        return {"userId": "usr_" + str(random.randint(1000, 9999)),
                "email": "user@example.com", "plan": random.choice(["BASIC","PRO"])}
    if topic.startswith("payment"):
        return {"paymentId": "PAY-" + str(random.randint(10000, 99999)),
                "amount": round(random.uniform(500, 50000), 2), "method": "UPI"}
    if topic.startswith("inventory"):
        return {"productId": "SKU-" + str(random.randint(1000, 9999)),
                "stock": random.randint(0, 1000)}
    return {"event": topic, "data": "payload_" + rand_id("data")}

def _update_consumers(ev):
    for c in CONSUMERS:
        if c["status"] == "offline":
            continue
        c["delivered"] += 1
        if random.random() < 0.04:
            c["lag"] = min(c["lag"] + random.randint(1, 8), 250)
        elif c["lag"] > 0:
            c["lag"] = max(0, c["lag"] - random.randint(1, 3))
        c["status"] = "lagging" if c["lag"] > 20 else "active"

def _broadcast(event_type, data):
    msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    with _sse_lock:
        dead = []
        for q in _sse_subscribers:
            try:
                q.put_nowait(msg)
            except Exception:
                dead.append(q)
        for q in dead:
            _sse_subscribers.remove(q)

# ─────────────────────────────────────────────────────────────
# ENGINE BACKGROUND THREAD
# ─────────────────────────────────────────────────────────────

def engine_loop():
    """Generate events every 250ms while engine is running."""
    while True:
        time.sleep(5)
        if not engine_state["running"]:
            continue

        batch_size = random.randint(2, 8)
        events_this_tick = []
        for _ in range(batch_size):
            ev = make_event()
            events_this_tick.append(ev)

        eps = round(batch_size * 4 + random.uniform(-5, 15))
        lat_avg = round(sum(e["latency"] for e in events_this_tick) / len(events_this_tick), 1)

        active = sum(1 for c in CONSUMERS if c["status"] != "offline")
        lagging = sum(1 for c in CONSUMERS if c["status"] == "lagging")
        err_rate = round(engine_state["total_errors"] / max(engine_state["total_events"], 1) * 100, 2)
        uptime = round(time.time() - engine_state["start_time"])

        payload = {
            "events":      events_this_tick,
            "eps":         eps,
            "latency":     lat_avg,
            "totalEvents": engine_state["total_events"],
            "totalErrors": engine_state["total_errors"],
            "errRate":     err_rate,
            "consumers":   {
                "active":   active,
                "lagging":  lagging,
                "offline":  sum(1 for c in CONSUMERS if c["status"] == "offline"),
                "list":     CONSUMERS,
            },
            "topicCounts": topic_counts,
            "uptime":      uptime,
        }
        _broadcast("tick", payload)

_engine_thread = threading.Thread(target=engine_loop, daemon=True)
_engine_thread.start()

# ─────────────────────────────────────────────────────────────
# ROUTES — SSE
# ─────────────────────────────────────────────────────────────

@app.route("/stream")
def stream():
    """SSE endpoint — clients connect here for real-time updates."""
    q = queue.Queue(maxsize=200)
    with _sse_lock:
        _sse_subscribers.append(q)

    def generate():
        # Send initial hello
        yield "event: connected\ndata: {\"msg\": \"Connected to RTESE\"}\n\n"
        try:
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield msg
                except queue.Empty:
                    yield ": keep-alive\n\n"
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                if q in _sse_subscribers:
                    _sse_subscribers.remove(q)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":              "no-cache",
            "X-Accel-Buffering":          "no",
            "Access-Control-Allow-Origin":"*",
        },
    )

# ─────────────────────────────────────────────────────────────
# ROUTES — REST API
# ─────────────────────────────────────────────────────────────

@app.route("/api/events", methods=["POST"])
def publish_event():
    body = request.get_json(force=True, silent=True) or {}
    topic    = body.get("topic",    random.choice(TOPICS))
    producer = body.get("producer", "svc-manual-001")
    priority = body.get("priority", "MEDIUM")
    payload  = body.get("payload",  {})

    if topic not in TOPICS:
        return jsonify({"error": "Unknown topic", "valid": TOPICS}), 400

    ev = make_event(topic=topic, producer=producer, priority=priority, payload=payload)
    _broadcast("published", ev)
    return jsonify({
        "status":     201,
        "eventId":    ev["id"],
        "sequenceId": ev["seqId"],
        "topic":      ev["topic"],
        "latency_ms": ev["latency"],
        "consumers":  ev["consumers"],
        "message":    "Event published successfully",
    }), 201

@app.route("/api/events", methods=["GET"])
def get_events():
    topic  = request.args.get("topic")
    status = request.args.get("status")
    limit  = int(request.args.get("limit", 100))
    results = event_log
    if topic:
        results = [e for e in results if e["topic"] == topic]
    if status:
        results = [e for e in results if e["status"] == status]
    return jsonify(results[:limit])

@app.route("/api/consumers", methods=["GET"])
def get_consumers():
    return jsonify(CONSUMERS)

@app.route("/api/consumers", methods=["POST"])
def add_consumer():
    body = request.get_json(force=True, silent=True) or {}
    new_c = {
        "id":        "cons_" + rand_id("")[4:8],
        "service":   body.get("service",   "svc-new-001"),
        "topics":    body.get("topics",    "*.*"),
        "proto":     body.get("proto",     "WebSocket"),
        "status":    "active",
        "lag":       0,
        "delivered": 0,
    }
    CONSUMERS.append(new_c)
    return jsonify(new_c), 201

@app.route("/api/consumers/<cid>", methods=["DELETE"])
def disconnect_consumer(cid):
    c = next((x for x in CONSUMERS if x["id"] == cid), None)
    if not c:
        return jsonify({"error": "Not found"}), 404
    c["status"] = "offline"
    return jsonify({"message": f"Consumer {cid} disconnected"})

@app.route("/api/engine", methods=["GET"])
def engine_status():
    uptime = round(time.time() - engine_state["start_time"])
    return jsonify({
        "running":     engine_state["running"],
        "seqId":       engine_state["seq_id"],
        "totalEvents": engine_state["total_events"],
        "totalErrors": engine_state["total_errors"],
        "uptime":      uptime,
        "errRate":     round(engine_state["total_errors"] / max(engine_state["total_events"], 1) * 100, 3),
    })

@app.route("/api/engine/toggle", methods=["POST"])
def toggle_engine():
    engine_state["running"] = not engine_state["running"]
    state = "running" if engine_state["running"] else "paused"
    _broadcast("engineState", {"state": state})
    return jsonify({"state": state})

@app.route("/api/metrics", methods=["GET"])
def get_metrics():
    stats = {}
    for t in TOPICS:
        cnt = topic_counts.get(t, 0)
        avg_lat = round(topic_lat_sum.get(t, 0) / max(topic_lat_cnt.get(t, 1), 1), 1)
        err = topic_errors.get(t, 0)
        stats[t] = {
            "count":   cnt,
            "avgLat":  avg_lat,
            "errors":  err,
            "errRate": round(err / max(cnt, 1) * 100, 2),
        }
    return jsonify({"topics": stats, "topicCounts": topic_counts})

@app.route("/api/replay", methods=["POST"])
def replay_events():
    """Stream replayed events for a topic/range via SSE-style JSON."""
    body = request.get_json(force=True, silent=True) or {}
    topic      = body.get("topic")
    from_seq   = int(body.get("fromSeq", 0))
    to_seq     = int(body.get("toSeq",   engine_state["seq_id"]))
    consumer   = body.get("consumer", "replay-target")

    src = [e for e in reversed(event_log)
           if (not topic or e["topic"] == topic)
           and from_seq <= e["seqId"] <= to_seq]

    replayed = []
    for ev in src:
        replayed.append({
            "seqId":   ev["seqId"],
            "id":      ev["id"],
            "topic":   ev["topic"],
            "latency": round(random.uniform(0.8, 2.5), 1),
            "status":  "ACK",
            "consumer": consumer,
        })

    _broadcast("replay", {"events": replayed, "count": len(replayed), "consumer": consumer})
    return jsonify({"replayed": len(replayed), "events": replayed[:50]})

# ─────────────────────────────────────────────────────────────
# MAIN PAGE
# ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

# ─────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "="*60)
    print("  Real Time Event Synchronization Engine")
    print("  Running at: http://localhost:5000")
    print("="*60 + "\n")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
