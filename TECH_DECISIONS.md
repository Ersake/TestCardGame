Decision 1 — Transport layer
geckos.io (WebRTC/UDP)	Socket.io (WebSockets/TCP)
Latency	Lower ceiling, no head-of-line blocking	Slightly higher, can spike under packet loss
Setup	Needs STUN server (free); TURN server for strict NATs (~$5–20/mo or self-hosted)	Just a port — no extra infrastructure
NAT traversal	Automatic via WebRTC ICE	Not needed — standard HTTP upgrade
Browser support	Full (WebRTC is universal)	Full
Rollback fit	Better — dropping a stale input packet is fine	Acceptable — rollback window is small so TCP retransmit rarely matters
Complexity	Higher	Lower
Verdict: For a PvP card fighter with sparse inputs (not a stream of position updates), TCP retransmit latency is rarely the bottleneck. Socket.io is viable and removes the TURN server problem entirely. geckos.io is the right call if you later add continuous high-frequency state — not yet needed.

Decision 2 — Topology
Pure P2P (WebRTC)	Thin relay server	Authoritative server
Latency	Lowest (direct peer path)	Peer path + one relay hop	Server round-trip always
Cheating	Either peer can cheat	Either peer can cheat	Server catches cheats
Infrastructure	STUN + optional TURN	Small Node.js relay (cheap)	Full Node.js sim server (more CPU)
Complexity	Highest (NAT traversal, no fallback)	Low — server just forwards packets	Medium — server runs the sim
Rollback fit	Natural fit	Natural fit	Rollback not needed (server is authoritative)
Verdict: A thin relay server is the sweet spot — you get rollback's latency benefits (clients simulate locally), avoid the NAT traversal complexity of pure P2P, and the server is trivially cheap (it just forwards stamped input packets, no game logic). This is what most indie rollback implementations use.

Decision 3 — Input delay + rollback depth
Pure rollback (0 frames of input delay) means every local input is immediately speculated and may be corrected. Small fixed input delay (1–2 frames, ~17–33ms) is imperceptible to players but dramatically reduces how often rollback fires, because both players' inputs arrive within the delay window most of the time on good connections.

0-frame delay (pure rollback)	1–2 frame fixed delay
Feel on good connection	Perfectly responsive	Imperceptibly delayed
Feel on bad connection	Lots of visible corrections	Fewer corrections, smoother
Rollback window needed	Up to full RTT (~10–30 frames)	RTT minus delay (often 0–5 frames)
Implementation complexity	Slightly higher	Slightly lower
Verdict: 1–2 frame input delay is the standard choice for online fighters (used by Guilty Gear Strive, Street Fighter 6, etc.). It's invisible on good connections and cuts rollback frequency significantly on bad ones. Recommend 2 frames (33ms).

Decision 4 — Rollback depth limit
How many frames back can you roll? More depth = handles higher latency gracefully, but costs more CPU per rollback event (re-simulate N ticks).

Max rollback depth	Handles RTT up to	CPU cost per rollback
8 frames	~133ms RTT	Re-simulate 8 ticks
15 frames	~250ms RTT	Re-simulate 15 ticks
30 frames	~500ms RTT	Re-simulate 30 ticks
Your simulation is lightweight (integer grid math). Simulating 15 ticks takes microseconds. 15 frames is a reasonable cap — covers anything under 250ms RTT which is intercontinental play.