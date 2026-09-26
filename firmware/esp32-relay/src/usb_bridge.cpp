#include "usb_bridge.h"

namespace {

enum class ParseState : uint8_t {
  WAIT_MAGIC,
  READ_TYPE,
  READ_LEN_LO,
  READ_LEN_HI,
  READ_PAYLOAD,
  READ_CHECKSUM,
};

UsbMessageCb g_onMessage;

ParseState g_state = ParseState::WAIT_MAGIC;
uint8_t g_type = 0;
uint16_t g_len = 0;
uint16_t g_received = 0;
uint8_t g_checksum = 0; // running sum over TYPE+LEN+PAYLOAD as bytes arrive

// Static, not stack-local: up to USB_MAX_PAYLOAD (6KB+) is too big to carry
// on the Arduino loop task's stack alongside everything else it calls.
static uint8_t g_inBuf[USB_MAX_PAYLOAD];

void resetParser() {
  g_state = ParseState::WAIT_MAGIC;
}

// setup()/loop() also write plain-text debug lines to this same Serial port
// (there's only one USB-CDC channel on this board, shared between flashing,
// human logs, and this protocol). A stray byte from that text could in
// principle land right after a real frame and get misread as the next
// magic byte; if a frame's checksum doesn't match, this resyncs on the next
// 0xC0 it sees rather than getting permanently stuck. In practice ASCII log
// text essentially never contains byte 0xC0, so this is rare.
void handleByte(uint8_t b) {
  switch (g_state) {
    case ParseState::WAIT_MAGIC:
      if (b == USB_FRAME_MAGIC) g_state = ParseState::READ_TYPE;
      break;

    case ParseState::READ_TYPE:
      g_type = b;
      g_checksum = b;
      g_state = ParseState::READ_LEN_LO;
      break;

    case ParseState::READ_LEN_LO:
      g_len = b;
      g_checksum = static_cast<uint8_t>(g_checksum + b);
      g_state = ParseState::READ_LEN_HI;
      break;

    case ParseState::READ_LEN_HI:
      g_len = static_cast<uint16_t>(g_len | (static_cast<uint16_t>(b) << 8));
      g_checksum = static_cast<uint8_t>(g_checksum + b);
      if (g_len > USB_MAX_PAYLOAD) {
        Serial.printf("[usb] frame claims %u bytes (> %u cap), resyncing\n",
                      g_len, static_cast<unsigned>(USB_MAX_PAYLOAD));
        resetParser();
        break;
      }
      g_received = 0;
      g_state = (g_len == 0) ? ParseState::READ_CHECKSUM : ParseState::READ_PAYLOAD;
      break;

    case ParseState::READ_PAYLOAD:
      g_inBuf[g_received++] = b;
      g_checksum = static_cast<uint8_t>(g_checksum + b);
      if (g_received >= g_len) g_state = ParseState::READ_CHECKSUM;
      break;

    case ParseState::READ_CHECKSUM:
      if (b == g_checksum) {
        if (g_onMessage) g_onMessage(g_type, g_inBuf, g_len);
      } else {
        Serial.println("[usb] checksum mismatch, dropping frame");
      }
      resetParser();
      break;
  }
}

} // namespace

void usbInit(UsbMessageCb onMessage) {
  g_onMessage = onMessage;
  resetParser();
}

void usbPoll() {
  while (Serial.available() > 0) {
    handleByte(static_cast<uint8_t>(Serial.read()));
  }
}

void usbSendFramed(uint8_t type, const uint8_t* json, size_t len) {
  if (len > USB_MAX_PAYLOAD) {
    Serial.printf("[usb] outbound message too large (%u > %u), dropping\n",
                  static_cast<unsigned>(len), static_cast<unsigned>(USB_MAX_PAYLOAD));
    return;
  }
  uint8_t lenLo = static_cast<uint8_t>(len & 0xFF);
  uint8_t lenHi = static_cast<uint8_t>((len >> 8) & 0xFF);
  uint8_t checksum = static_cast<uint8_t>(type + lenLo + lenHi);
  for (size_t i = 0; i < len; i++) checksum = static_cast<uint8_t>(checksum + json[i]);

  Serial.write(USB_FRAME_MAGIC);
  Serial.write(type);
  Serial.write(lenLo);
  Serial.write(lenHi);
  if (len > 0) Serial.write(json, len);
  Serial.write(checksum);
}
