#pragma once
#include <Arduino.h>
#include <functional>
#include "protocol.h"

// `type` is one of USB_TYPE_*; json/len is the reassembled UTF-8 payload for
// that message (see protocol.h for the JSON envelope shape of each type).
using UsbMessageCb = std::function<void(uint8_t type, const uint8_t* json, size_t len)>;

void usbInit(UsbMessageCb onMessage);
// Call every loop() iteration - drains whatever Serial bytes have arrived and
// dispatches any complete frame(s) found in them. Serial has no
// write-callback the way the old BLE GATT server did, so this has to be
// polled instead of being purely event-driven.
void usbPoll();
void usbSendFramed(uint8_t type, const uint8_t* json, size_t len);
