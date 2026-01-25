# Viewer-Aware Mini-CDN Streaming

## Overview

Implement intelligent streaming that adapts based on viewer count per channel, minimizing server load for single viewers while efficiently serving multiple concurrent viewers.

## Current State

- `streaming-service.ts` already acts as mini-CDN for transcoded streams
- One FFmpeg process serves multiple viewers via shared segment files
- Missing: viewer tracking (only tracks streams, not viewer count)

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    STREAMING MODES                          │
├──────────────┬──────────────┬──────────────────────────────┤
│   Viewers    │     Mode     │     Description              │
├──────────────┼──────────────┼──────────────────────────────┤
│      1       │   Direct     │ Viewer connects to source    │
│              │              │ (zero server load)           │
├──────────────┼──────────────┼──────────────────────────────┤
│     2-3      │   Proxy      │ Server proxies, caches segs  │
│              │              │ (minimal CPU, some bandwidth)│
├──────────────┼──────────────┼──────────────────────────────┤
│     4+       │  Transcode   │ Full HLS with shared segs    │
│              │              │ (one transcode, N viewers)   │
└──────────────┴──────────────┴──────────────────────────────┘
```

## Data Structure

```typescript
// Enhanced activeStreams tracking
activeStreams: Map<streamId, {
  process: ChildProcess | null,  // null for direct/proxy mode
  timestamp: number,
  mode: 'direct' | 'proxy' | 'transcode',
  viewers: Set<sessionId>,
  viewerCount: number,
  sourceUrl: string
}>
```

## Implementation Components

### 1. Viewer Heartbeat System
- Client sends heartbeat every 30s with channelId + sessionId
- Server tracks active viewers per channel
- Viewer removed after 60s without heartbeat

### 2. Viewer Tracking Service
```typescript
class ViewerTracker {
  private channelViewers: Map<channelId, Set<sessionId>>

  addViewer(channelId, sessionId): number  // returns viewer count
  removeViewer(channelId, sessionId): number
  getViewerCount(channelId): number
  cleanupStaleViewers(): void  // called periodically
}
```

### 3. Mode Promotion Logic
```
When viewer joins:
  count = viewerTracker.addViewer(channel, session)
  if count == 1: use DIRECT mode
  if count == 2-3: promote to PROXY mode
  if count >= 4: promote to TRANSCODE mode

When viewer leaves:
  count = viewerTracker.removeViewer(channel, session)
  if count < 4 and mode == TRANSCODE: consider demoting
  if count == 0: cleanup stream entirely
```

### 4. Seamless Mode Handoff (Hard)
- When promoting from direct → proxy:
  - Start proxy, wait for first segment
  - Send client new URL via WebSocket/SSE
  - Client switches at next segment boundary

- When promoting from proxy → transcode:
  - Start transcode, wait for playlist ready
  - Existing proxy viewers get redirected
  - New viewers go directly to transcode URL

## API Endpoints

```
POST /api/stream/heartbeat
  Body: { channelId, sessionId }
  Response: { viewerCount, mode, streamUrl }

GET /api/stream/:channelId/status
  Response: { viewerCount, mode, health }
```

## Client Changes

```typescript
// In video player initialization
const heartbeatInterval = setInterval(() => {
  fetch('/api/stream/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ channelId, sessionId })
  }).then(res => res.json()).then(data => {
    if (data.streamUrl !== currentStreamUrl) {
      // Mode changed, switch to new URL at next opportunity
      pendingStreamSwitch = data.streamUrl;
    }
  });
}, 30000);
```

## Benefits

| Scenario | Current | With Mini-CDN |
|----------|---------|---------------|
| 1 viewer, 1 channel | Full transcode | Direct (0% CPU) |
| 5 viewers, 1 channel | 5 transcodes | 1 transcode (80% savings) |
| Mixed channels | All transcode | Adaptive per channel |

## Risks & Mitigations

1. **Mode switch causes playback glitch**
   - Mitigation: Switch at segment boundary, buffer ahead

2. **Viewer count oscillates (2↔3)**
   - Mitigation: Hysteresis - require count to stay above/below threshold for 30s

3. **Race conditions during promotion**
   - Mitigation: Lock per-channel during mode transitions

## Estimated Effort

| Component | Effort |
|-----------|--------|
| Viewer heartbeat | 2-3 hours |
| Viewer tracking service | 2-3 hours |
| Mode promotion logic | 4-6 hours |
| Seamless handoff | 8-12 hours |
| Client integration | 4-6 hours |
| Testing | 4-6 hours |
| **Total** | **24-36 hours** |

## Dependencies

- Requires HLS.js improvements first (error recovery, discontinuity handling)
- Probe caching would help with smart mode selection
