import { OfflineMutation } from '../types';
import { apiUrl } from './apiBase';

/**
 * Browser side of the offline ESP-NOW mesh relay.
 *
 * Story: this laptop is tethered by USB to exactly one ESP32. When
 * storageService can't reach the backend directly, it hands the queued
 * mutation to this service, which forwards it to the paired ESP32. The ESP32
 * floods it across an ESP-NOW mesh of other ESP32s until it reaches a node
 * whose OWN paired laptop has internet - that laptop (running this same
 * service) applies the mutation to the backend and the result travels back
 * through the mesh to the originating ESP32/laptop.
 *
 * Every node runs both directions at once rather than a manual mode switch:
 * this laptop may simultaneously be relaying its own offline work out AND
 * be asked to apply a mutation flooded in from someone else's node.
 *
 * This hop was originally Bluetooth LE, but combining a BLE GATT server with
 * ESP-NOW on one radio turned out to be a deep, recurring source of
 * instability on the ESP32 (WiFi/BT coexistence aborts, heap contention
 * preventing esp_now_init from succeeding, flaky GATT connections) - USB
 * serial sidesteps all of it by not touching the Bluetooth radio at all, at
 * the cost of the laptop needing to stay physically plugged into its ESP32.
 *
 * Wire format must match firmware/esp32-relay/include/protocol.h exactly -
 * see MESH-RELAY.md at the repo root for the full protocol writeup.
 */

const USB_FRAME_MAGIC = 0xc0;
const USB_FRAME_HEADER_LEN = 4; // magic, type, lenLo, lenHi
const USB_FRAME_CHECKSUM_LEN = 1;

const USB_TYPE_OUTBOUND_MUTATION = 1; // this laptop -> esp32: "relay this, I'm offline"
const USB_TYPE_INBOUND_REQUEST = 2; // esp32 -> this laptop: "mesh needs an internet check for this"
const USB_TYPE_INBOUND_RESULT = 3; // this laptop -> esp32: result of that check
const USB_TYPE_SYNCED_ACK = 4; // esp32 -> this laptop: "your earlier mutation is confirmed synced"

const INTERNET_PROBE_TIMEOUT_MS = 4000;
const SERIAL_BAUD_RATE = 115200;

export interface EspRelayState {
  supported: boolean;
  connected: boolean;
  deviceName: string | null;
  outboundPending: number;
  relayedForOthersCount: number;
  lastError: string | null;
}

class EspRelayService {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private connected = false;
  private deviceName: string | null = null;
  private outboundPending = 0;
  private relayedForOthersCount = 0;
  private lastError: string | null = null;
  private listeners = new Set<(state: EspRelayState) => void>();
  private syncedAckListeners = new Set<(localId: string, ok: boolean) => void>();

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.serial;
  }

  public getState(): EspRelayState {
    return {
      supported: this.isSupported(),
      connected: this.connected,
      deviceName: this.deviceName,
      outboundPending: this.outboundPending,
      relayedForOthersCount: this.relayedForOthersCount,
      lastError: this.lastError,
    };
  }

  public subscribe(listener: (state: EspRelayState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fires when the mesh confirms one of THIS laptop's own mutations was synced. */
  public onSyncedAck(listener: (localId: string, ok: boolean) => void): () => void {
    this.syncedAckListeners.add(listener);
    return () => this.syncedAckListeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  /** Must be called from a user gesture (e.g. a button click) - the browser requires it to open the port picker. */
  public async connect(): Promise<boolean> {
    if (!this.isSupported()) {
      this.lastError = 'Web Serial is not supported in this browser. Use Chrome or Edge.';
      this.notify();
      return false;
    }
    try {
      const port = await navigator.serial!.requestPort();
      await port.open({ baudRate: SERIAL_BAUD_RATE });
      this.port = port;

      const info = port.getInfo();
      this.deviceName =
        info.usbVendorId != null
          ? `USB serial (${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)})`
          : 'USB serial device';

      this.connected = true;
      this.lastError = null;
      this.notify();
      void this.readLoop(port);
      return true;
    } catch (error: any) {
      this.lastError = error?.message || 'Failed to connect to the paired ESP32.';
      this.notify();
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.reader?.cancel();
    } catch {
      // ignore - handleDisconnected still runs below
    }
    try {
      await this.writer?.close();
    } catch {
      // ignore
    }
    try {
      await this.port?.close();
    } catch {
      // ignore
    }
    this.handleDisconnected();
  }

  private handleDisconnected(): void {
    this.connected = false;
    this.port = null;
    this.writer = null;
    this.reader = null;
    this.notify();
  }

  // originalLocalId -> chunks still outstanding + whether all seen so far
  // were ok. Only used when relayMutation() had to split a payload; a
  // single-chunk mutation acks directly with its own localId, no tracking.
  private pendingChunkGroups = new Map<string, { remaining: number; ok: boolean }>();

  /** storageService calls this when a mutation can't reach the backend directly. */
  public relayMutation(mutation: OfflineMutation): void {
    if (!this.connected) return;
    this.outboundPending += 1;
    this.notify();

    const chunks = this.chunkPayloadForRelay(mutation.action, mutation.payload);
    if (chunks.length > 1) {
      this.pendingChunkGroups.set(mutation.id, { remaining: chunks.length, ok: true });
    }
    chunks.forEach((payload, i) => {
      const wireLocalId = chunks.length > 1 ? `${mutation.id}#chunk${i}` : mutation.id;
      const json = JSON.stringify({ localId: wireLocalId, action: mutation.action, payload });
      console.log(`[EspRelayService] Relaying ${mutation.action} chunk ${i + 1}/${chunks.length}, ${json.length} bytes over USB`);
      void this.sendFramed(USB_TYPE_OUTBOUND_MUTATION, json);
    });
  }

  // Conservative vs. the ESP-NOW mesh layer's own ~5.6KB cap (protocol.h's
  // MESH_MAX_FRAGMENTS*MESH_DATA_MAX) - every mutation still has to fit
  // through that hop regardless of what USB itself could carry, so this
  // stays sized to the mesh, not the (much larger) USB_MAX_PAYLOAD ceiling.
  private static readonly RELAY_CHUNK_BYTE_BUDGET = 3000;

  /**
   * A stock check covering a whole location's inventory can run to tens of
   * KB of JSON, far past what one ESP-NOW mesh hop can carry. Rather than
   * drop data, split `items` into several independently-relayed mutations
   * (each floods/acks through the mesh on its own); the backend merges them
   * back into one record by item name (see _apply_stock_check in
   * database/app.py), so delivery order doesn't matter - which is good,
   * because ESP-NOW flooding gives no such guarantee.
   */
  private chunkPayloadForRelay(action: OfflineMutation['action'], payload: any): any[] {
    if (action !== 'STOCK_CHECK' || !Array.isArray(payload?.items) || payload.items.length === 0) {
      return [payload];
    }
    const { items, ...meta } = payload;
    const envelopeBytes = JSON.stringify({ ...meta, items: [] }).length;
    const chunks: any[] = [];
    let current: any[] = [];
    let currentBytes = envelopeBytes;

    for (const item of items) {
      const itemBytes = JSON.stringify(item).length + 1; // +1 for the joining comma
      if (current.length > 0 && currentBytes + itemBytes > EspRelayService.RELAY_CHUNK_BYTE_BUDGET) {
        chunks.push({ ...meta, items: current });
        current = [];
        currentBytes = envelopeBytes;
      }
      current.push(item);
      currentBytes += itemBytes;
    }
    if (current.length > 0) chunks.push({ ...meta, items: current });
    return chunks;
  }

  /**
   * Serial is a raw byte stream with no built-in message boundaries (unlike
   * BLE's per-characteristic-write packets), so this runs a small framing
   * state machine over whatever chunks arrive from the reader - which can
   * split a frame arbitrarily, or bundle several frames into one chunk.
   * Mirrors firmware/esp32-relay/src/usb_bridge.cpp exactly.
   */
  private async readLoop(port: SerialPort): Promise<void> {
    if (!port.readable) return;
    const reader = port.readable.getReader();
    this.reader = reader;

    let state: 'magic' | 'type' | 'lenLo' | 'lenHi' | 'payload' | 'checksum' = 'magic';
    let type = 0;
    let len = 0;
    let checksum = 0;
    let payload: Uint8Array = new Uint8Array(0);
    let received = 0;

    const resetParser = () => {
      state = 'magic';
    };

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        for (const b of value) {
          switch (state) {
            case 'magic':
              if (b === USB_FRAME_MAGIC) state = 'type';
              break;
            case 'type':
              type = b;
              checksum = b;
              state = 'lenLo';
              break;
            case 'lenLo':
              len = b;
              checksum = (checksum + b) & 0xff;
              state = 'lenHi';
              break;
            case 'lenHi':
              len |= b << 8;
              checksum = (checksum + b) & 0xff;
              payload = new Uint8Array(len);
              received = 0;
              state = len === 0 ? 'checksum' : 'payload';
              break;
            case 'payload':
              payload[received++] = b;
              checksum = (checksum + b) & 0xff;
              if (received >= len) state = 'checksum';
              break;
            case 'checksum':
              if (b === checksum) {
                void this.handleMessage(type, new TextDecoder().decode(payload));
              } else {
                console.error('[EspRelayService] USB frame checksum mismatch, dropping');
              }
              resetParser();
              break;
          }
        }
      }
    } catch (error) {
      console.error('[EspRelayService] USB read loop ended:', error);
    } finally {
      this.handleDisconnected();
    }
  }

  private async handleMessage(type: number, json: string): Promise<void> {
    let data: any;
    try {
      data = JSON.parse(json);
    } catch (error) {
      console.error('[EspRelayService] Malformed USB payload:', error);
      return;
    }

    if (type === USB_TYPE_INBOUND_REQUEST) {
      await this.attemptRelayForOther(data.relayToken, data.action, data.payload);
    } else if (type === USB_TYPE_SYNCED_ACK) {
      this.handleSyncedAck(data.localId, !!data.ok);
    }
  }

  /**
   * A chunked mutation (see chunkPayloadForRelay) acks one chunk at a time
   * under wire ids like "<mutationId>#chunk0" - only surface a synced-ack for
   * the ORIGINAL mutation id once every chunk has reported back, since
   * storageService.markMutationSynced() looks up its pending queue by that
   * one id and only removes the whole mutation when it fires.
   */
  private handleSyncedAck(wireLocalId: string, ok: boolean): void {
    const chunkMatch = /^(.*)#chunk\d+$/.exec(wireLocalId);
    if (!chunkMatch) {
      this.outboundPending = Math.max(0, this.outboundPending - 1);
      this.notify();
      this.syncedAckListeners.forEach((listener) => listener(wireLocalId, ok));
      return;
    }

    const originalId = chunkMatch[1];
    const group = this.pendingChunkGroups.get(originalId);
    if (!group) return; // unknown/already-completed group - ignore a stray ack
    group.remaining -= 1;
    if (!ok) group.ok = false;
    if (group.remaining > 0) return;

    this.pendingChunkGroups.delete(originalId);
    this.outboundPending = Math.max(0, this.outboundPending - 1);
    this.notify();
    this.syncedAckListeners.forEach((listener) => listener(originalId, group.ok));
  }

  /**
   * Another node's mutation reached us through the mesh because its own
   * laptop had no internet. Check whether WE have internet, and if so apply
   * it on the origin's behalf. Any failure (offline, request error, backend
   * rejection) is silent - the flood keeps trying other nodes until the TTL
   * runs out, rather than this node sending a premature negative ack.
   */
  private async attemptRelayForOther(relayToken: string, action: string, payload: any): Promise<void> {
    try {
      const online = await this.probeInternet();
      if (!online) return;

      const response = await fetch(apiUrl('/api/mutations/relay'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      });
      if (!response.ok) return;

      this.relayedForOthersCount += 1;
      this.notify();
      await this.sendFramed(USB_TYPE_INBOUND_RESULT, JSON.stringify({ relayToken, ok: true }));
    } catch (error) {
      console.error('[EspRelayService] Relay-for-other failed:', error);
    }
  }

  private async probeInternet(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), INTERNET_PROBE_TIMEOUT_MS);
      const response = await fetch(apiUrl('/api/health'), { credentials: 'include', signal: controller.signal });
      window.clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async sendFramed(type: number, json: string): Promise<void> {
    if (!this.port?.writable) return;
    const payload = new TextEncoder().encode(json);
    const frame = new Uint8Array(USB_FRAME_HEADER_LEN + payload.length + USB_FRAME_CHECKSUM_LEN);
    frame[0] = USB_FRAME_MAGIC;
    frame[1] = type;
    frame[2] = payload.length & 0xff;
    frame[3] = (payload.length >> 8) & 0xff;
    frame.set(payload, USB_FRAME_HEADER_LEN);

    let checksum = type;
    checksum = (checksum + frame[2]) & 0xff;
    checksum = (checksum + frame[3]) & 0xff;
    for (const b of payload) checksum = (checksum + b) & 0xff;
    frame[frame.length - 1] = checksum;

    try {
      if (!this.writer) this.writer = this.port.writable.getWriter();
      await this.writer.write(frame);
    } catch (error) {
      console.error('[EspRelayService] USB write failed:', error);
    }
  }
}

export const espRelayService = new EspRelayService();
