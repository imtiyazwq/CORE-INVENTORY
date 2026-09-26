#pragma once
#include <cstdint>

// =============================================================================
// CORE INVENTORY offline mesh relay protocol
//
// Two independent framing layers share this header:
//
//   1. ESP-NOW mesh layer (ESP32 <-> ESP32): binary MeshFrame struct, flooded
//      with a TTL and deduped by msgId+fragIndex. Carries a compact JSON blob
//      of just {"action":..., "payload":...} - the mesh never sees a laptop's
//      local mutation id, only the 8-byte msgId it assigns itself.
//
//   2. USB serial layer (laptop <-> its own ESP32, over the same cable used
//      to flash it): a length-prefixed frame carrying a JSON payload. This is
//      the only layer the browser (src/services/espRelayService.ts) speaks,
//      via the Web Serial API. Originally this hop was Bluetooth LE, but
//      combining a BLE GATT server with ESP-NOW on one radio turned out to be
//      a deep, recurring source of instability on this chip (WiFi/BT
//      coexistence aborts, heap contention preventing esp_now_init from
//      succeeding, flaky GATT connections) - USB sidesteps all of it by not
//      using the Bluetooth radio at all. The tradeoff is a laptop must stay
//      physically tethered to its paired ESP32 instead of just nearby.
//
// A single ESP32 node runs both directions concurrently instead of an
// explicit "mode switch": it must be able to originate its own laptop's
// offline mutations into the mesh AND forward other nodes' flooded mutations
// to its own laptop at the same time, since any node may sit in the middle
// of another node's flood path.
// =============================================================================

// ---- ESP-NOW mesh frame ----------------------------------------------------

static const uint8_t MESH_PROTO_VERSION = 1;
static const uint8_t MESH_MSG_DATA = 1; // a fragment of a relayed mutation, flooding outward
static const uint8_t MESH_MSG_ACK  = 2; // "this mutation reached the internet", travelling back to origin

static const uint8_t MESH_DATA_MAX = 200;   // bytes of JSON per ESP-NOW fragment
static const uint8_t MESH_TTL_DEFAULT = 8;  // max hops before a flood is dropped
static const uint8_t MSG_ID_LEN = 8;        // random id assigned by the origin node, mesh-internal only
static const uint8_t MESH_MAX_FRAGMENTS = 28; // caps reassembly buffer size per in-flight message (28*200 = 5600 bytes)

#pragma pack(push, 1)
struct MeshFrame {
  uint8_t version;
  uint8_t msgType;                 // MESH_MSG_DATA or MESH_MSG_ACK
  uint8_t msgId[MSG_ID_LEN];
  uint8_t originMac[6];            // MAC of the ESP32 whose laptop was offline
  uint8_t ttl;
  uint8_t fragIndex;
  uint8_t fragTotal;
  uint16_t fragLen;                // bytes of `data` actually used in this fragment
  uint8_t ackOk;                   // MESH_MSG_ACK only: 1 = applied successfully
  uint8_t data[MESH_DATA_MAX];
};
#pragma pack(pop)
// sizeof(MeshFrame) = 1+1+8+6+1+1+1+2+1+200 = 222 bytes, under the 250-byte
// ESP-NOW payload ceiling.

// ---- USB serial laptop <-> ESP32 framing -----------------------------------
// Serial is a raw byte STREAM with no natural message boundaries (unlike
// BLE's per-characteristic-write packets), so frames need an explicit sync
// byte + length instead of relying on the transport to delimit messages.
// One frame per message - no need to fragment/reassemble across multiple
// packets the way BLE's small ATT MTU forced, since a serial write isn't
// size-limited the same way.
//
// Wire layout: MAGIC(1) TYPE(1) LEN_LO(1) LEN_HI(1) PAYLOAD(LEN bytes) CHECKSUM(1)
// LEN is little-endian. CHECKSUM is a sum-of-bytes (mod 256) over
// TYPE+LEN+PAYLOAD - a cheap integrity check against a corrupted byte; USB
// serial is reliable but not infallible, and there's no retry above this
// layer for a single garbled frame (the mesh's own flood/ack retry already
// covers the case where a whole mutation needs to be attempted again).

static const uint8_t USB_FRAME_MAGIC = 0xC0;
static const uint8_t USB_FRAME_HEADER_LEN = 4; // magic, type, lenLo, lenHi

static const uint8_t USB_TYPE_OUTBOUND_MUTATION = 1; // laptop -> esp32: "relay this, I'm offline"
static const uint8_t USB_TYPE_INBOUND_REQUEST   = 2; // esp32 -> laptop: "mesh needs an internet check for this"
static const uint8_t USB_TYPE_INBOUND_RESULT    = 3; // laptop -> esp32: result of that check
static const uint8_t USB_TYPE_SYNCED_ACK        = 4; // esp32 -> laptop: "your earlier mutation is confirmed synced"

// Ceiling for a single USB frame's payload. Kept a bit above the ESP-NOW mesh
// layer's own ceiling (MESH_MAX_FRAGMENTS*MESH_DATA_MAX above) rather than
// much larger: every mutation still has to fit through that mesh hop
// regardless of how big USB itself could carry, so there's no benefit
// over-provisioning this past what the mesh can actually flood onward -
// chunkPayloadForRelay() in espRelayService.ts still splits anything bigger
// than the mesh can carry, same as it did for the old BLE cap.
static const size_t USB_MAX_PAYLOAD = 6144;

// Capacity for parsing/re-serializing a full {action, payload} mutation in
// main.cpp. Needs real headroom above USB_MAX_PAYLOAD: ArduinoJson has to
// duplicate every string value out of the (const, non-zero-copy) input
// buffer and also store the parse tree itself, so usable capacity is well
// below the raw byte count.
static const size_t MUTATION_JSON_CAPACITY = 8192;

// JSON envelope shapes carried inside each USB message type (see
// src/services/espRelayService.ts for the TypeScript side of this):
//
//   OUTBOUND_MUTATION  { "localId": string, "action": string, "payload": any }
//   INBOUND_REQUEST    { "relayToken": hex16, "action": string, "payload": any }
//   INBOUND_RESULT     { "relayToken": hex16, "ok": boolean }
//   SYNCED_ACK         { "localId": string, "ok": boolean }
