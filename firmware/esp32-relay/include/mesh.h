#pragma once
#include <Arduino.h>
#include <functional>
#include "protocol.h"

// Fired when a fragmented mutation flooded in from another node has been
// fully reassembled and this node has not delivered it yet. `originMac` must
// be handed back unchanged to meshSendAck() so the ack can find its way home.
using MeshRelayRequestCb =
    std::function<void(const uint8_t token[MSG_ID_LEN], const uint8_t originMac[6], const uint8_t* json, size_t len)>;

// Fired when a RELAY_ACK addressed back to *this* node arrives, i.e. this
// node originated the mutation and some node downstream (possibly several
// hops away) confirmed it reached the backend.
using MeshOwnAckCb = std::function<void(const uint8_t token[MSG_ID_LEN], bool ok)>;

void meshInit(uint8_t wifiChannel, MeshRelayRequestCb onRelayRequest, MeshOwnAckCb onOwnAck);

// This node's own laptop has a mutation to relay because it has no internet.
// Floods it across the mesh and writes the assigned 8-byte token to outToken
// so the caller can remember localId <-> token for the eventual ack.
void meshFloodMutation(const uint8_t* json, size_t len, uint8_t outToken[MSG_ID_LEN]);

// This node's laptop finished checking a relayed mutation (token/originMac
// came from a prior onRelayRequest) and reports whether it reached the
// backend. Only call this on success; on failure just do nothing and let the
// flood keep trying other nodes (see firmware/esp32-relay/README.md).
void meshSendAck(const uint8_t token[MSG_ID_LEN], const uint8_t originMac[6], bool ok);

void meshLoop();
