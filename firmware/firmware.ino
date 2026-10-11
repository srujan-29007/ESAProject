#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include "arduino_secrets.h"

// --- Wi-Fi & MQTT Configuration ---
const char* ssid = WIFI_SSID;
const char* password = WIFI_PASSWORD;
const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;
// Live feed for open dashboards: the stored scan exactly as the cloud API
// returned it (id, name, time), so viewers don't need to look anything up.
const char* scan_topic = "smart_tray_25BCE2885/scan";
// Heartbeat for the dashboard's device-health panel, retained so a newly
// opened dashboard sees it at once. The broker publishes {"online":false}
// here (our last will, also retained) if we drop off.
const char* status_topic = "smart_tray_25BCE2885/status";
const unsigned long HEARTBEAT_MS = 5000;

// --- RFID Pins (ESP32 standard SPI pins) ---
#define RST_PIN 22
#define SS_PIN 21
MFRC522 mfrc522(SS_PIN, RST_PIN);

WiFiClient espClient;
PubSubClient client(espClient);

// --- Offline scan queue ---
// Every scan goes through this ring buffer. It's flushed to the cloud API
// whenever Wi-Fi is up, so taps made while the hotspot is down (or the API is
// unreachable) are delivered once it's back.
// When full, the oldest scan is dropped.
struct QueuedScan { char uid[21]; unsigned long at; };
const int QUEUE_MAX = 50;
QueuedScan queue[QUEUE_MAX];
int qHead = 0, qCount = 0;

void enqueue(const String& uid) {
  if (qCount == QUEUE_MAX) {
    qHead = (qHead + 1) % QUEUE_MAX;
    qCount--;
    Serial.println("[QUEUE] Full - dropped oldest scan");
  }
  QueuedScan& q = queue[(qHead + qCount) % QUEUE_MAX];
  strncpy(q.uid, uid.c_str(), sizeof(q.uid) - 1);
  q.uid[sizeof(q.uid) - 1] = '\0';
  q.at = millis();
  qCount++;
}

bool online() { return WiFi.status() == WL_CONNECTED; }

// POSTs one scan to the cloud API. Returns the HTTP status (negative on a
// network error) and fills `response` with the stored scan's JSON.
int post_scan(const QueuedScan& q, String& response) {
  WiFiClientSecure tls;
  tls.setInsecure();  // skip certificate pinning - fine for a course demo
  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(tls, INGEST_URL)) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);
  char body[96];
  snprintf(body, sizeof(body), "{\"rfidUid\":\"%s\",\"ageMs\":%lu}", q.uid, millis() - q.at);
  int code = http.POST((uint8_t*)body, strlen(body));
  if (code > 0) response = http.getString();
  http.end();
  return code;
}

unsigned long lastFlushFail = 0;
void flush_queue() {
  if (lastFlushFail && millis() - lastFlushFail < 5000) return;  // back off after a failure
  int sent = 0;
  while (qCount > 0 && online()) {
    QueuedScan& q = queue[qHead];
    String response;
    int code = post_scan(q, response);
    if (code == 200) {
      Serial.printf("Saved to cloud: %s\n", response.c_str());
      if (client.connected()) client.publish(scan_topic, response.c_str());
    } else if (code >= 400 && code < 500 && code != 408 && code != 429) {
      // The API rejected it (e.g. wrong device key) - retrying won't help.
      Serial.printf("[CLOUD] Rejected %s (HTTP %d): %s - dropped\n", q.uid, code, response.c_str());
    } else {
      Serial.printf("[CLOUD] Upload failed (%d) - %d scan(s) kept, retrying in 5s\n", code, qCount);
      lastFlushFail = millis();
      return;
    }
    lastFlushFail = 0;
    qHead = (qHead + 1) % QUEUE_MAX;
    qCount--;
    sent++;
  }
  if (sent > 1) Serial.printf("[QUEUE] Delivered %d scans\n", sent);
}

void scan_wifi() {
  Serial.println("[WIFI] Scanning...");
  int n = WiFi.scanNetworks();
  bool found = false;
  for (int i = 0; i < n; i++) {
    Serial.printf("[WIFI]   %-32s ch%-2d %d dBm\n", WiFi.SSID(i).c_str(), WiFi.channel(i), WiFi.RSSI(i));
    if (WiFi.SSID(i) == ssid) found = true;
  }
  Serial.printf("[WIFI] Target \"%s\" %s\n", ssid, found ? "VISIBLE" : "NOT FOUND (hotspot off / 5GHz-only?)");
}

// Non-blocking: kicks off a connection attempt at most every 10s.
unsigned long lastWifiAttempt = 0;
void ensure_wifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (lastWifiAttempt && millis() - lastWifiAttempt < 10000) return;
  lastWifiAttempt = millis();
  Serial.printf("[WIFI] Connecting (status=%d)...\n", WiFi.status());
  WiFi.disconnect();
  WiFi.begin(ssid, password);
}

unsigned long lastHeartbeat = 0;
byte lastLinkVersion = 0xFF;

bool reader_ok() { return lastLinkVersion != 0x00 && lastLinkVersion != 0xFF; }

void send_heartbeat() {
  if (!client.connected()) return;
  lastHeartbeat = millis();
  char payload[200];
  snprintf(payload, sizeof(payload),
    "{\"online\":true,\"rssi\":%d,\"uptimeS\":%lu,\"reader\":\"%s\",\"readerVersion\":\"0x%02X\",\"queued\":%d,\"ip\":\"%s\"}",
    WiFi.RSSI(), millis() / 1000, reader_ok() ? "ok" : "lost", lastLinkVersion, qCount,
    WiFi.localIP().toString().c_str());
  client.publish(status_topic, payload, true);
}

unsigned long lastMqttAttempt = 0;
void ensure_mqtt() {
  if (WiFi.status() != WL_CONNECTED || client.connected()) return;
  if (lastMqttAttempt && millis() - lastMqttAttempt < 5000) return;
  lastMqttAttempt = millis();
  Serial.printf("[WIFI] Connected, IP %s\n", WiFi.localIP().toString().c_str());
  Serial.print("[MQTT] Connecting to HiveMQ Broker...");
  String clientId = "ESP32Client-";
  clientId += String(random(0xffff), HEX);
  if (client.connect(clientId.c_str(), status_topic, 0, true, "{\"online\":false}")) {
    Serial.println("Connected!");
    send_heartbeat();
  } else {
    Serial.printf("Failed, rc=%d, retrying in 5s\n", client.state());
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  SPI.begin();
  mfrc522.PCD_Init();
  byte v = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.printf("[RFID] VersionReg=0x%02X %s\n", v, (v == 0x00 || v == 0xFF) ? "-> NOT RESPONDING (check wiring)" : "-> OK");

  WiFi.mode(WIFI_STA);
  scan_wifi();
  client.setServer(mqtt_server, mqtt_port);
  ensure_wifi();
  Serial.println("RFID Scanner Ready. Tap a tag...");
}

unsigned long lastLinkCheck = 0;

void loop() {
  ensure_wifi();
  ensure_mqtt();
  client.loop();
  flush_queue();

  if (millis() - lastLinkCheck > 1000) {
    lastLinkCheck = millis();
    byte v = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
    if (v != lastLinkVersion) {
      lastLinkVersion = v;
      if (v == 0x00 || v == 0xFF) {
        Serial.printf("[LINK] LOST  (reg=0x%02X)\n", v);
      } else {
        Serial.printf("[LINK] GOOD  (reg=0x%02X)\n", v);
      }
      send_heartbeat();  // reader state changed - tell the dashboard now
    }
    // A glitch on the wiring can reset the MFRC522 (antenna off, registers
    // back to defaults), so re-init whenever it's lost or its antenna is off.
    bool antennaOff = (mfrc522.PCD_ReadRegister(MFRC522::TxControlReg) & 0x03) != 0x03;
    if (v == 0x00 || v == 0xFF || antennaOff) {
      mfrc522.PCD_Init();
      if (antennaOff && v != 0x00 && v != 0xFF) Serial.println("[RFID] Reader had reset - re-initialized");
    }
  }

  if (millis() - lastHeartbeat > HEARTBEAT_MS) send_heartbeat();

  // Look for new RFID cards
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    return;
  }

  // Get the UID of the tag
  String tagUID = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    tagUID += String(mfrc522.uid.uidByte[i] < 0x10 ? "0" : "");
    tagUID += String(mfrc522.uid.uidByte[i], HEX);
  }
  tagUID.toUpperCase();

  Serial.print("Scanned Tag: ");
  Serial.println(tagUID);

  enqueue(tagUID);
  if (online()) {
    flush_queue();
  } else {
    Serial.printf("[QUEUE] Offline - saved, %d scan(s) waiting to send\n", qCount);
  }

  // Halt reading to prevent spamming while the card is still on the reader
  mfrc522.PICC_HaltA();
  delay(1000);
}
