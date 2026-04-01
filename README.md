# Real Time Event Synchronization Engine (RTESE)
## Milestone Project 1 — Full Stack Application Development (Java)
### Student: Vajrala Venkata Siva Prasad | VTU26004 | Reg: 23UECS0585
### Course: 10211CS224 | Faculty: Dr. Angeline Lydia

---

## Quick Start (2 steps)

### 1. Install dependency
```bash
pip install flask
```

### 2. Run the server
```bash
cd rtese
python app.py
```

Open your browser at: **http://localhost:5000**

---

## Features

| Section | Description |
|---|---|
| **Dashboard** | Live event stream, KPI cards, topic distribution, consumer health — all via Server-Sent Events |
| **Publish Event** | REST API form to publish custom events with JSON payload, auto-fill, and response display |
| **Consumers** | Consumer registry with live lag bars, protocol badges, register/disconnect controls |
| **Event Log** | Searchable, filterable real-time event log with priority and ACK/NACK status |
| **Replay** | Replay events by topic + sequence range at configurable speed |
| **Metrics** | Live Chart.js throughput + latency charts, topic statistics table |
| **Architecture** | Full system architecture diagram + technology stack |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Main web UI |
| GET | `/stream` | SSE stream (real-time updates) |
| POST | `/api/events` | Publish a new event |
| GET | `/api/events` | Get event log (with filters) |
| GET | `/api/consumers` | List all consumers |
| POST | `/api/consumers` | Register a new consumer |
| DELETE | `/api/consumers/<id>` | Disconnect a consumer |
| GET | `/api/engine` | Engine status |
| POST | `/api/engine/toggle` | Pause / resume engine |
| GET | `/api/metrics` | Topic statistics |
| POST | `/api/replay` | Replay events |

---

## Technology

- **Backend:** Python 3 + Flask (pure stdlib + Flask only)
- **Real-time:** Server-Sent Events (SSE) — no WebSocket library needed
- **Frontend:** Vanilla JS + Chart.js (CDN)
- **No database required** — runs fully in-memory

---

## Project Structure

```
rtese/
├── app.py                  ← Flask backend + event engine
├── README.md
├── templates/
│   └── index.html          ← Main HTML template
└── static/
    ├── css/
    │   └── style.css       ← Dark theme UI styles
    └── js/
        └── app.js          ← SSE client + all UI logic
```
