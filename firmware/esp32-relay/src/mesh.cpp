#include "mesh.h"
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <string.h>

namespace {

const uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

MeshRelayRequestCb g_onRelayRequest;
MeshOwnAckCb g_onOwnAck;
uint8_t g_selfMac[6];

// ---- seen-fragment dedupe (msgId+fragIndex), prevents rebroadcast storms ----
struct SeenEntry {
  uint8_t msgId[MSG_ID_LEN];
  uint8_t fragIndex;
  bool used;
};
const int SEEN_CAP = 64;
SeenEntry g_seen[SEEN_CAP];
int g_seenNext = 0;

bool alreadySeen(const uint8_t* msgId, uint8_t fragIndex) {
  for (int i = 0; i < SEEN_CAP; i++) {
    if (g_seen[i].used && g_seen[i].fragIndex == fragIndex && memcmp(g_seen[i].msgId, msgId, MSG_ID_LEN) == 0) {
      return true;
    }
  }
  return false;
}

void markSeen(const uint8_t* msgId, uint8_t fragIndex) {
  g_seen[g_seenNext].used = true;
  g_seen[g_seenNext].fragIndex = fragIndex;
  memcpy(g_seen[g_seenNext].msgId, msgId, MSG_ID_LEN);
  g_seenNext = (g_seenNext + 1) % SEEN_CAP;
}

// ---- reverse-path table: msgId -> the neighbour that first delivered it ----
// This is what lets an ACK retrace the flood back to its origin hop-by-hop
// instead of being flooded a second time.
struct ParentEntry {
  uint8_t msgId[MSG_ID_LEN];
  uint8_t parentMac[6];
  bool used;
};
const int PARENT_CAP = 40;
ParentEntry g_parents[PARENT_CAP];
int g_parentNext = 0;

bool findParent(const uint8_t* msgId, uint8_t outMac[6]) {
  for (int i = 0; i < PARENT_CAP; i++) {
    if (g_parents[i].used && memcmp(g_parents[i].msgId, msgId, MSG_ID_LEN) == 0) {
      memcpy(outMac, g_parents[i].parentMac, 6);
      return true;
    }
  }
  return false;
}

void rememberParent(const uint8_t* msgId, const uint8_t* mac) {
  for (int i = 0; i < PARENT_CAP; i++) {
    // First-seen wins: keep the shortest/fastest path we heard this on.
    if (g_parents[i].used && memcmp(g_parents[i].msgId, msgId, MSG_ID_LEN) == 0) return;
  }
  g_parents[g_parentNext].used = true;
  memcpy(g_parents[g_parentNext].msgId, msgId, MSG_ID_LEN);
  memcpy(g_parents[g_parentNext].parentMac, mac, 6);
  g_parentNext = (g_parentNext + 1) % PARENT_CAP;
}

// ---- reassembly buffers for inbound DATA fragments -------------------------
struct InFlight {
  uint8_t msgId[MSG_ID_LEN];
  uint8_t originMac[6];
  uint8_t fragTotal;
  uint16_t fragLens[MESH_MAX_FRAGMENTS];
  uint8_t data[MESH_MAX_FRAGMENTS][MESH_DATA_MAX];
  bool have[MESH_MAX_FRAGMENTS];
  bool used;
  bool delivered;
  uint32_t startedAt;
};
// Each slot now holds up to MESH_MAX_FRAGMENTS*MESH_DATA_MAX bytes of
// reassembly buffer, so this is kept modest - 3 concurrent in-flight
// mutations is still comfortable headroom for a small test mesh, and every
// extra slot here multiplies DRAM usage by a few KB.
const int INFLIGHT_CAP = 3;
InFlight g_inflight[INFLIGHT_CAP];

InFlight* findOrCreateInflight(const uint8_t* msgId, const uint8_t* originMac, uint8_t fragTotal) {
  for (int i = 0; i < INFLIGHT_CAP; i++) {
    if (g_inflight[i].used && memcmp(g_inflight[i].msgId, msgId, MSG_ID_LEN) == 0) return &g_inflight[i];
  }
  int victim = 0;
  for (int i = 1; i < INFLIGHT_CAP; i++) {
    if (!g_inflight[i].used || g_inflight[i].startedAt < g_inflight[victim].startedAt) victim = i;
  }
  InFlight& slot = g_inflight[victim];
  memset(&slot, 0, sizeof(InFlight));
  memcpy(slot.msgId, msgId, MSG_ID_LEN);
  memcpy(slot.originMac, originMac, 6);
  slot.fragTotal = fragTotal;
  slot.used = true;
  slot.startedAt = millis();
  return &slot;
}

// ---- peer registration ------------------------------------------------------
// ESP-NOW refuses esp_now_send() to a MAC that hasn't been registered with
// esp_now_add_peer() first, so every MAC we ever unicast to (ACK routing)
// gets added lazily here.
void ensurePeer(const uint8_t* mac) {
  if (esp_now_is_peer_exist(mac)) return;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = 0; // stay on whatever channel esp_wifi_set_channel already picked
  peer.encrypt = false;
  esp_now_add_peer(&peer);
}

void sendFrame(const uint8_t* mac, MeshFrame& frame) {
  ensurePeer(mac);
  esp_now_send(mac, reinterpret_cast<uint8_t*>(&frame), sizeof(MeshFrame));
}

void floodFrame(MeshFrame& frame) {
  sendFrame(BROADCAST_MAC, frame);
}

void genMsgId(uint8_t out[MSG_ID_LEN]) {
  for (int i = 0; i < MSG_ID_LEN; i++) out[i] = static_cast<uint8_t>(esp_random() & 0xFF);
}

void logToken(const char* prefix, const uint8_t* token) {
  Serial.print(prefix);
  for (int i = 0; i < MSG_ID_LEN; i++) Serial.printf("%02x", token[i]);
  Serial.println();
}

void handleData(const MeshFrame& frame, const uint8_t* senderMac) {
  // Our own flood echoing back through a neighbour - not a relay request.
  if (memcmp(frame.originMac, g_selfMac, 6) == 0) return;

  bool firstTimeFragment = !alreadySeen(frame.msgId, frame.fragIndex);
  if (firstTimeFragment) markSeen(frame.msgId, frame.fragIndex);
  rememberParent(frame.msgId, senderMac);

  // Keep flooding outward (minus this hop) as long as this exact fragment is
  // new and the message still has hops left. Duplicates are dropped here so
  // the flood terminates instead of echoing forever.
  if (firstTimeFragment && frame.ttl > 0) {
    MeshFrame relay = frame;
    relay.ttl -= 1;
    floodFrame(relay);
  }

  InFlight* slot = findOrCreateInflight(frame.msgId, frame.originMac, frame.fragTotal);
  if (frame.fragIndex < MESH_MAX_FRAGMENTS && !slot->have[frame.fragIndex]) {
    slot->have[frame.fragIndex] = true;
    slot->fragLens[frame.fragIndex] = frame.fragLen;
    memcpy(slot->data[frame.fragIndex], frame.data, frame.fragLen);
  }
  if (slot->delivered) return;
  for (uint8_t i = 0; i < slot->fragTotal; i++) {
    if (!slot->have[i]) return; // still waiting on more fragments
  }

  // Static, not stack-local: this now runs up to 6400 bytes and the ESP-NOW
  // recv callback's task stack is too small to carry that safely.
  static uint8_t joined[MESH_MAX_FRAGMENTS * MESH_DATA_MAX];
  size_t total = 0;
  for (uint8_t i = 0; i < slot->fragTotal; i++) {
    memcpy(joined + total, slot->data[i], slot->fragLens[i]);
    total += slot->fragLens[i];
  }
  slot->delivered = true;
  logToken("[mesh] relay request fully reassembled, token=", frame.msgId);
  if (g_onRelayRequest) g_onRelayRequest(frame.msgId, frame.originMac, joined, total);
}

void handleAck(const MeshFrame& frame) {
  if (memcmp(frame.originMac, g_selfMac, 6) == 0) {
    logToken("[mesh] ack arrived home, token=", frame.msgId);
    if (g_onOwnAck) g_onOwnAck(frame.msgId, frame.ackOk != 0);
    return;
  }
  uint8_t parentMac[6];
  MeshFrame relay = frame;
  if (findParent(frame.msgId, parentMac)) {
    logToken("[mesh] forwarding ack toward origin, token=", frame.msgId);
    sendFrame(parentMac, relay);
  } else {
    // No remembered path (evicted, or we never actually saw the original
    // DATA ourselves) - fall back to a best-effort flood so the ack still
    // has a chance of reaching the origin some other way.
    logToken("[mesh] no known path for ack, flooding as fallback, token=", frame.msgId);
    floodFrame(relay);
  }
}

// The espressif32 platform version this project builds against still ships
// the pre-esp_now_recv_info_t callback signature (plain sender MAC, no RSSI
// metadata struct) - keep this matching esp_now_recv_cb_t exactly or the
// registration call fails to compile.
void onRecv(const uint8_t* macAddr, const uint8_t* incomingData, int len) {
  if (len != sizeof(MeshFrame)) return;
  MeshFrame frame;
  memcpy(&frame, incomingData, sizeof(MeshFrame));
  if (frame.version != MESH_PROTO_VERSION) return;

  if (frame.msgType == MESH_MSG_DATA) {
    handleData(frame, macAddr);
  } else if (frame.msgType == MESH_MSG_ACK) {
    handleAck(frame);
  }
}

} // namespace

void meshInit(uint8_t wifiChannel, MeshRelayRequestCb onRelayRequest, MeshOwnAckCb onOwnAck) {
  g_onRelayRequest = onRelayRequest;
  g_onOwnAck = onOwnAck;

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  // No BLE/BT running anymore (see usb_bridge.h - the laptop link moved to
  // USB serial), so there's no coexistence arbiter forcing modem sleep on.
  // WIFI_PS_NONE gives ESP-NOW the lowest latency when WiFi doesn't have to
  // share the radio with Bluetooth.
  WiFi.setSleep(false);
  esp_err_t channelErr = esp_wifi_set_channel(wifiChannel, WIFI_SECOND_CHAN_NONE);
  if (channelErr != ESP_OK) {
    Serial.printf("[mesh] esp_wifi_set_channel failed: %s\n", esp_err_to_name(channelErr));
  }
  WiFi.macAddress(g_selfMac);

  Serial.printf("[mesh] free heap before esp_now_init: %u bytes\n", (unsigned)ESP.getFreeHeap());

  esp_err_t nowErr = esp_now_init();
  if (nowErr != ESP_OK) {
    Serial.printf("[mesh] esp_now_init failed: %s\n", esp_err_to_name(nowErr));
    return;
  }
  esp_now_register_recv_cb(onRecv);
  ensurePeer(BROADCAST_MAC);

  Serial.print("[mesh] ready, self MAC = ");
  Serial.println(WiFi.macAddress());
}

void meshFloodMutation(const uint8_t* json, size_t len, uint8_t outToken[MSG_ID_LEN]) {
  genMsgId(outToken);
  uint8_t fragTotal = static_cast<uint8_t>((len + MESH_DATA_MAX - 1) / MESH_DATA_MAX);
  if (fragTotal == 0) fragTotal = 1;
  if (fragTotal > MESH_MAX_FRAGMENTS) fragTotal = MESH_MAX_FRAGMENTS; // truncates pathological oversize payloads

  for (uint8_t i = 0; i < fragTotal; i++) {
    MeshFrame frame = {};
    frame.version = MESH_PROTO_VERSION;
    frame.msgType = MESH_MSG_DATA;
    memcpy(frame.msgId, outToken, MSG_ID_LEN);
    memcpy(frame.originMac, g_selfMac, 6);
    frame.ttl = MESH_TTL_DEFAULT;
    frame.fragIndex = i;
    frame.fragTotal = fragTotal;

    size_t offset = static_cast<size_t>(i) * MESH_DATA_MAX;
    size_t chunk = min(static_cast<size_t>(MESH_DATA_MAX), len - offset);
    frame.fragLen = static_cast<uint16_t>(chunk);
    memcpy(frame.data, json + offset, chunk);

    floodFrame(frame);
    markSeen(outToken, i); // don't re-relay this if a neighbour echoes it straight back
  }
  logToken("[mesh] flooded mutation, token=", outToken);
}

void meshSendAck(const uint8_t token[MSG_ID_LEN], const uint8_t originMac[6], bool ok) {
  MeshFrame frame = {};
  frame.version = MESH_PROTO_VERSION;
  frame.msgType = MESH_MSG_ACK;
  memcpy(frame.msgId, token, MSG_ID_LEN);
  memcpy(frame.originMac, originMac, 6);
  frame.ttl = MESH_TTL_DEFAULT;
  frame.fragIndex = 0;
  frame.fragTotal = 1;
  frame.fragLen = 0;
  frame.ackOk = ok ? 1 : 0;

  uint8_t parentMac[6];
  if (findParent(token, parentMac)) {
    sendFrame(parentMac, frame);
  } else {
    floodFrame(frame);
  }
}

void meshLoop() {
  // ESP-NOW is fully callback-driven; nothing to poll today. Kept as a hook
  // point for future periodic diagnostics (e.g. logging table occupancy).
}
