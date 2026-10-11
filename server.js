// RFID scan backend — bridges the ESP32's MQTT publishes to the live
// dashboard over Socket.io, and persists a name + scan history per tag.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
// The dashboard runs on a different port, so allow it to call the REST API.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const MQTT_TOPIC = 'smart_tray_25BCE2885/rfid';
// ESP32 heartbeat: WiFi signal, uptime, reader health, offline-queue size.
const STATUS_TOPIC = 'smart_tray_25BCE2885/status';

// Latest heartbeat from the scanner (null until the first one arrives).
let device = null;

const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker, subscribing to', MQTT_TOPIC);
  mqttClient.subscribe([MQTT_TOPIC, STATUS_TOPIC]);
});

mqttClient.on('error', (err) => console.error('MQTT error:', err.message));

mqttClient.on('message', async (topic, message) => {
  if (topic !== MQTT_TOPIC && topic !== STATUS_TOPIC) return;

  let data;
  try {
    data = JSON.parse(message.toString());
  } catch {
    console.error('Bad MQTT payload:', message.toString());
    return;
  }

  if (topic === STATUS_TOPIC) {
    // `online: false` is the broker-delivered last will when the ESP32 drops off.
    device = { ...data, online: data.online !== false, receivedAt: Date.now() };
    io.emit('device', device);
    return;
  }

  const rfidUid = data.rfidUid;
  if (!rfidUid) return;

  // Scans queued on the ESP32 while it was offline carry how long ago they
  // happened, so they're stored at their real time rather than arrival time.
  const ageMs = Number(data.ageMs) || 0;
  const delayed = ageMs > 3000 && ageMs < 7 * 24 * 3600 * 1000;
  const scannedAt = delayed ? new Date(Date.now() - ageMs) : new Date();

  try {
    // Auto-register any tag we haven't seen before, so every tap shows up
    // live even if nobody's named it yet.
    let tag = await prisma.tag.findUnique({ where: { rfidUid } });
    if (!tag) {
      tag = await prisma.tag.create({ data: { rfidUid, name: `Tag ${rfidUid}` } });
    }

    const scan = await prisma.scan.create({ data: { tagId: tag.id, createdAt: scannedAt } });
    if (delayed) console.log(`Late scan ${rfidUid} from ${Math.round(ageMs / 1000)}s ago (was queued offline)`);

    io.emit('scan', {
      rfidUid: tag.rfidUid,
      name: tag.name,
      scanId: scan.id,
      time: scan.createdAt,
      delayed,
    });
  } catch (err) {
    console.error('Error processing scan:', err);
  }
});

// --- REST API ---

// List all known tags.
app.get('/api/tags', async (_req, res) => {
  const tags = await prisma.tag.findMany({ orderBy: { createdAt: 'asc' } });
  res.json(tags);
});

// Rename a tag (creates it if it doesn't exist yet).
app.patch('/api/tags/:rfidUid', async (req, res) => {
  const { rfidUid } = req.params;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 40) {
    return res.status(400).json({ error: 'name is required (max 40 chars)' });
  }
  const tag = await prisma.tag.upsert({
    where: { rfidUid },
    update: { name },
    create: { rfidUid, name },
  });
  io.emit('tag', tag);
  res.json(tag);
});

// Recent scan history.
app.get('/api/scans', async (_req, res) => {
  const scans = await prisma.scan.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { tag: true },
  });
  res.json(scans.map((s) => ({
    scanId: s.id,
    rfidUid: s.tag.rfidUid,
    name: s.tag.name,
    time: s.createdAt,
  })));
});

// Scan count per tag, optionally only since a given time (?since=ISO date).
app.get('/api/usage', async (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : null;
  if (since && isNaN(since)) return res.status(400).json({ error: 'bad since' });
  const groups = await prisma.scan.groupBy({
    by: ['tagId'],
    where: since ? { createdAt: { gte: since } } : undefined,
    _count: { _all: true },
  });
  const tags = await prisma.tag.findMany({ where: { id: { in: groups.map((g) => g.tagId) } } });
  const byId = new Map(tags.map((t) => [t.id, t]));
  res.json(groups.map((g) => ({
    rfidUid: byId.get(g.tagId).rfidUid,
    name: byId.get(g.tagId).name,
    count: g._count._all,
  })));
});

// Latest scanner heartbeat.
app.get('/api/device', (_req, res) => res.json(device));

io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id);
  if (device) socket.emit('device', device);
  socket.on('disconnect', () => console.log('Dashboard disconnected:', socket.id));
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
