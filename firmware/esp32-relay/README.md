# CORE INVENTORY — ESP32 mesh relay firmware

Flash this **identical** firmware onto every ESP32 in the mesh. There is no
per-node build or role to configure — every node runs both relay directions
at once (see `MESH-RELAY.md` at the repo root for the full system design).

## Hardware / requirements

- Any ESP32 dev board (this targets `esp32dev` in `platformio.ini`; change
  the `board` field if you're using something else, e.g. `esp32-s3-devkitc-1`).
- [PlatformIO](https://platformio.org/) (VS Code extension or CLI). The
  Arduino IDE also works if you prefer — just create a sketch that includes
  `src/main.cpp`, `src/mesh.cpp`, `src/usb_bridge.cpp` and the `include/`
  headers, and install the **ArduinoJson** library (v6) via Library Manager.
- One ESP32 per laptop that needs offline relay coverage, and each laptop
  stays plugged into its ESP32 via USB the whole time it wants relay
  coverage — this link is USB serial, not Bluetooth (see "Why USB, not
  Bluetooth" below).

## Build & flash

```bash
cd firmware/esp32-relay
pio run -t upload
pio device monitor
```

On boot the serial monitor should print the node's MAC address and free
heap, then settle into an idle ESP-NOW-ready state waiting for its laptop to
open the USB serial connection.

## Connecting a laptop to its ESP32

1. Plug the ESP32 into the laptop it's paired with via USB and power it on.
2. In the CORE INVENTORY web app, open **Settings → Offline Mesh Relay** and
   click **Connect ESP32**. This uses the [Web Serial
   API](https://developer.chrome.com/docs/capabilities/serial), so it only
   works in Chrome/Edge and requires a user click (browsers block serial
   port access from firing automatically).
3. Pick the ESP32's port from the browser's port picker (it'll show up as
   whatever the board's USB-to-serial chip reports, e.g. "CP2102 USB to UART
   Bridge" or similar — same port you'd pick for `pio device monitor`).
4. Once connected, the Settings page shows connection status and relay
   counters. No further configuration is needed — the mesh side requires no
   pairing between ESP32s at all (see below).

## Why USB, not Bluetooth

This link was originally Bluetooth LE. In practice, combining a BLE GATT
server with ESP-NOW on the same 2.4GHz radio turned out to be a deep,
recurring source of instability on the ESP32: the WiFi/BT coexistence
arbiter would abort the boot outright depending on init order and power-save
settings, and even once that was worked around, the BLE stack's own runtime
heap usage could starve `esp_now_init()` of the memory it needed to
succeed — inconsistently, board to board. Moving the laptop link to USB
serial removes the Bluetooth radio from the picture entirely, at the cost of
the laptop needing to stay physically tethered to its ESP32 instead of just
nearby. ESP32-to-ESP32 mesh traffic is unaffected either way — that always
ran over ESP-NOW (WiFi), never Bluetooth.

## Why there's no per-node mesh configuration

Every node registers ESP-NOW's broadcast address as its only static peer and
floods mutations to it; other nodes are discovered implicitly by being in
radio range, not by a configured peer list. This means:

- Nodes can be added/removed/repositioned without touching firmware config.
- All nodes must share one fixed WiFi channel (`MESH_WIFI_CHANNEL` in
  `main.cpp`, defaults to `1`) since ESP-NOW has no channel negotiation.
- A flood is bounded by a hop-count TTL (`MESH_TTL_DEFAULT` in
  `include/protocol.h`, defaults to 8) and a per-node seen-message cache, so
  it dies out instead of looping forever.

See `MESH-RELAY.md` at the repo root for the full protocol (message framing,
flood/ack routing, and how this plugs into `storageService.ts`).
