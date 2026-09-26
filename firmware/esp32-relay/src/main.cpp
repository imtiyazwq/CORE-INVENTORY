// CORE INVENTORY offline mesh relay node.
//
// Flashed identically onto every ESP32 in the mesh - there is no per-role
// build. Each node:
//   - talks to exactly one laptop over USB serial (see usb_bridge.h),
//   - floods that laptop's offline mutations into the ESP-NOW mesh,
//   - forwards mutations flooded by OTHER nodes to its own laptop so that
//     laptop can check its own internet connection and relay to the backend,
//   - routes the resulting ack back through the mesh to whichever node
//     originated the mutation.
//
// See firmware/esp32-relay/README.md for flashing/pairing instructions and
// MESH-RELAY.md (repo root) for the end-to-end system design.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <string.h>

#include "protocol.h"
#include "mesh.h"
#include "usb_bridge.h"

// All nodes must agree on a fixed WiFi channel for ESP-NOW - there is no
// association/handshake to negotiate one automatically.
static const uint8_t MESH_WIFI_CHANNEL = 1;

namespace {

void hexEncode(const uint8_t* bytes, size_t len, char* out /* len*2 + 1 */) {
  static const char* digits = "0123456789abcdef";
  for (size_t i = 0; i < len; i++) {
    out[i * 2] = digits[(bytes[i] >> 4) & 0xF];
    out[i * 2 + 1] = digits[bytes[i] & 0xF];
  }
  out[len * 2] = '\0';
}

bool hexDecode(const char* hex, uint8_t* out, size_t outLen) {
  if (strlen(hex) != outLen * 2) return false;
  for (size_t i = 0; i < outLen; i++) {
    char hi = hex[i * 2];
    char lo = hex[i * 2 + 1];
    auto nib = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      if (c >= 'A' && c <= 'F') return c - 'A' + 10;
      return -1;
    };
    int h = nib(hi), l = nib(lo);
    if (h < 0 || l < 0) return false;
    out[i] = static_cast<uint8_t>((h << 4) | l);
  }
  return true;
}

// ---- token(8 bytes) -> localId, for mutations THIS node originated --------
struct OriginRecord {
  uint8_t token[MSG_ID_LEN];
  char localId[48];
  bool used;
  uint32_t at;
};
const int ORIGIN_CAP = 16;
OriginRecord g_origins[ORIGIN_CAP];

void rememberOrigin(const uint8_t token[MSG_ID_LEN], const char* localId) {
  int victim = 0;
  for (int i = 0; i < ORIGIN_CAP; i++) {
    if (!g_origins[i].used) { victim = i; break; }
    if (g_origins[i].at < g_origins[victim].at) victim = i;
  }
  memcpy(g_origins[victim].token, token, MSG_ID_LEN);
  strncpy(g_origins[victim].localId, localId, sizeof(g_origins[victim].localId) - 1);
  g_origins[victim].localId[sizeof(g_origins[victim].localId) - 1] = '\0';
  g_origins[victim].used = true;
  g_origins[victim].at = millis();
}

bool takeOrigin(const uint8_t token[MSG_ID_LEN], char* outLocalId, size_t outCap) {
  for (int i = 0; i < ORIGIN_CAP; i++) {
    if (g_origins[i].used && memcmp(g_origins[i].token, token, MSG_ID_LEN) == 0) {
      strncpy(outLocalId, g_origins[i].localId, outCap - 1);
      outLocalId[outCap - 1] = '\0';
      g_origins[i].used = false;
      return true;
    }
  }
  return false;
}

// ---- token(8 bytes) -> originMac, for relay requests awaiting a laptop's --
// ---- internet-check result -------------------------------------------------
struct PendingInbound {
  uint8_t token[MSG_ID_LEN];
  uint8_t originMac[6];
  bool used;
  uint32_t at;
};
const int PENDING_CAP = 16;
PendingInbound g_pending[PENDING_CAP];

void rememberPending(const uint8_t token[MSG_ID_LEN], const uint8_t originMac[6]) {
  int victim = 0;
  for (int i = 0; i < PENDING_CAP; i++) {
    if (!g_pending[i].used) { victim = i; break; }
    if (g_pending[i].at < g_pending[victim].at) victim = i;
  }
  memcpy(g_pending[victim].token, token, MSG_ID_LEN);
  memcpy(g_pending[victim].originMac, originMac, 6);
  g_pending[victim].used = true;
  g_pending[victim].at = millis();
}

bool takePending(const uint8_t token[MSG_ID_LEN], uint8_t outOriginMac[6]) {
  for (int i = 0; i < PENDING_CAP; i++) {
    if (g_pending[i].used && memcmp(g_pending[i].token, token, MSG_ID_LEN) == 0) {
      memcpy(outOriginMac, g_pending[i].originMac, 6);
      g_pending[i].used = false;
      return true;
    }
  }
  return false;
}

// ---- wiring between the USB bridge and the mesh ----------------------------

void onMeshRelayRequest(const uint8_t token[MSG_ID_LEN], const uint8_t originMac[6], const uint8_t* json, size_t len) {
  // Static: these are big enough now (MUTATION_JSON_CAPACITY) that they
  // can't safely live on the ESP-NOW callback's stack.
  static StaticJsonDocument<MUTATION_JSON_CAPACITY> incoming;
  if (deserializeJson(incoming, json, len) != DeserializationError::Ok) {
    Serial.println("[main] dropped a relay request with malformed JSON");
    return;
  }
  Serial.printf("[main] mesh relay request -> forwarding to laptop over USB, action=%s\n",
                (const char*)(incoming["action"] | "?"));

  rememberPending(token, originMac);

  char tokenHex[MSG_ID_LEN * 2 + 1];
  hexEncode(token, MSG_ID_LEN, tokenHex);

  static StaticJsonDocument<MUTATION_JSON_CAPACITY> outgoing;
  outgoing.clear();
  outgoing["relayToken"] = tokenHex;
  outgoing["action"] = incoming["action"];
  outgoing["payload"] = incoming["payload"];

  static char buf[MUTATION_JSON_CAPACITY];
  size_t n = serializeJson(outgoing, buf, sizeof(buf));
  usbSendFramed(USB_TYPE_INBOUND_REQUEST, reinterpret_cast<uint8_t*>(buf), n);
}

void onMeshOwnAck(const uint8_t token[MSG_ID_LEN], bool ok) {
  char localId[48];
  if (!takeOrigin(token, localId, sizeof(localId))) {
    Serial.println("[main] ack arrived for an unknown/expired token, ignoring");
    return;
  }
  Serial.printf("[main] own mutation synced, localId=%s ok=%d\n", localId, ok ? 1 : 0);

  StaticJsonDocument<128> outgoing;
  outgoing["localId"] = localId;
  outgoing["ok"] = ok;

  char buf[128];
  size_t n = serializeJson(outgoing, buf, sizeof(buf));
  usbSendFramed(USB_TYPE_SYNCED_ACK, reinterpret_cast<uint8_t*>(buf), n);
}

void onUsbMessage(uint8_t type, const uint8_t* json, size_t len) {
  if (type == USB_TYPE_OUTBOUND_MUTATION) {
    // Static: sized for MUTATION_JSON_CAPACITY, too big to put on the loop
    // task's stack safely.
    static StaticJsonDocument<MUTATION_JSON_CAPACITY> incoming;
    if (deserializeJson(incoming, json, len) != DeserializationError::Ok) {
      Serial.println("[main] dropped an outbound mutation with malformed/oversize JSON");
      return;
    }

    const char* localId = incoming["localId"] | "";
    if (!localId[0]) return;
    Serial.printf("[main] laptop queued an offline mutation, localId=%s\n", localId);

    static StaticJsonDocument<MUTATION_JSON_CAPACITY> forMesh;
    forMesh.clear();
    forMesh["action"] = incoming["action"];
    forMesh["payload"] = incoming["payload"];
    static char buf[MUTATION_JSON_CAPACITY];
    size_t n = serializeJson(forMesh, buf, sizeof(buf));

    uint8_t token[MSG_ID_LEN];
    meshFloodMutation(reinterpret_cast<uint8_t*>(buf), n, token);
    rememberOrigin(token, localId);

  } else if (type == USB_TYPE_INBOUND_RESULT) {
    StaticJsonDocument<128> incoming;
    if (deserializeJson(incoming, json, len) != DeserializationError::Ok) return;

    const char* tokenHex = incoming["relayToken"] | "";
    bool ok = incoming["ok"] | false;
    if (!ok) return; // failures are silent - let the flood keep trying other nodes

    uint8_t token[MSG_ID_LEN];
    if (!hexDecode(tokenHex, token, MSG_ID_LEN)) return;

    uint8_t originMac[6];
    if (!takePending(token, originMac)) return;

    Serial.printf("[main] laptop confirmed relay success, token=%s -> sending ack into mesh\n", tokenHex);
    meshSendAck(token, originMac, true);
  }
}

} // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n[boot] CORE INVENTORY mesh relay node starting");

  // No more BLE-vs-WiFi init ordering to worry about now that the laptop
  // link is USB, not Bluetooth - there's only one radio (WiFi/ESP-NOW) in
  // play, so no coexistence arbiter to trip over.
  usbInit(onUsbMessage);
  meshInit(MESH_WIFI_CHANNEL, onMeshRelayRequest, onMeshOwnAck);
}

void loop() {
  usbPoll();
  meshLoop();
  delay(5);
}
