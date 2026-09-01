import { SerialPort } from "serialport";

const MODBUS_READ_GROSS = Buffer.from([0x01, 0x03, 0x00, 0x01, 0x00, 0x04, 0x15, 0xc9]);

function crc16(buffer) {
  let crc = 0xffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? ((crc >>> 1) ^ 0xa001) : (crc >>> 1);
  }
  return crc;
}

function parseContinuousFrame(frame) {
  if (frame.length !== 12 || frame[0] !== 0x02 || frame[11] !== 0x03) return null;
  const sign = frame[1] === 0x2d ? -1 : frame[1] === 0x2b ? 1 : 0;
  const digits = frame.subarray(2, 8).toString("ascii");
  const decimals = Number.parseInt(String.fromCharCode(frame[8]), 10);
  if (!sign || !/^\d{6}$/.test(digits) || !Number.isInteger(decimals) || decimals < 0 || decimals > 4) return null;

  const expectedCheck = frame.subarray(2, 9).reduce((value, byte) => value ^ byte, 0);
  const receivedCheck = Number.parseInt(frame.subarray(9, 11).toString("ascii"), 16);
  if (Number.isFinite(receivedCheck) && receivedCheck !== expectedCheck) return null;

  return sign * (Number(digits) / (10 ** decimals));
}

// Some D2008FA installations send the compact 8-byte stream
//   STX, sign, six ASCII weight digits
// without the decimal/checksum/ETX bytes used by the longer stream.
function parseCompactFrame(frame) {
  if (frame.length !== 8 || frame[0] !== 0x02) return null;
  const sign = frame[1] === 0x2d ? -1 : frame[1] === 0x2b ? 1 : 0;
  const digits = frame.subarray(2, 8).toString("ascii");
  if (!sign || !/^\d{6}$/.test(digits)) return null;
  return sign * Number(digits);
}

function parseModbusFrame(frame) {
  if (frame.length < 13 || frame[0] !== 0x01 || frame[1] !== 0x03 || frame[2] !== 0x08) return null;
  const dataEnd = 3 + frame[2];
  if (frame.length < dataEnd + 2) return null;
  const expectedCrc = crc16(frame.subarray(0, dataEnd));
  const receivedCrc = frame[dataEnd] | (frame[dataEnd + 1] << 8);
  if (expectedCrc !== receivedCrc) return null;

  const signByte = frame[3];
  const digits = frame.subarray(4, 10).toString("ascii");
  const decimalByte = frame[10];
  if (!/^\d{6}$/.test(digits)) return null;
  const decimals = decimalByte >= 0x30 && decimalByte <= 0x34 ? decimalByte - 0x30 : 0;
  return (signByte === 0x2d ? -1 : 1) * (Number(digits) / (10 ** decimals));
}

function extractReading(buffer) {
  for (let start = 0; start <= buffer.length - 12; start += 1) {
    if (buffer[start] !== 0x02) continue;
    const weight = parseContinuousFrame(buffer.subarray(start, start + 12));
    if (weight !== null) return { weight, consumed: start + 12, protocol: "continuous-tf0" };
  }

  for (let start = 0; start <= buffer.length - 8; start += 1) {
    if (buffer[start] !== 0x02) continue;
    const weight = parseCompactFrame(buffer.subarray(start, start + 8));
    if (weight !== null) return { weight, consumed: start + 8, protocol: "compact-8byte" };
  }

  for (let start = 0; start <= buffer.length - 13; start += 1) {
    if (buffer[start] !== 0x01 || buffer[start + 1] !== 0x03) continue;
    const byteCount = buffer[start + 2];
    const frameLength = 3 + byteCount + 2;
    if (start + frameLength > buffer.length) continue;
    const weight = parseModbusFrame(buffer.subarray(start, start + frameLength));
    if (weight !== null) return { weight, consumed: start + frameLength, protocol: "modbus-tf1" };
  }

  return null;
}

export function startD2008faSerial({ onWeight, onStatus }) {
  const path = process.env.SCALE_COM_PORT || "COM1";
  const baudRate = Number(process.env.SCALE_BAUD_RATE || 9600);
  // The existing Sơn Phú weighing software is configured for 8N2.
  const stopBits = Number(process.env.SCALE_STOP_BITS || 2);
  let stopped = false;
  let activePort = null;
  let retryTimer = null;
  let pollTimer = null;

  const report = (details) => onStatus?.({ path, baudRate, ...details });

  const scheduleNext = (delay = 1800) => {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(openCandidate, delay);
  };

  const closePort = async () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    const port = activePort;
    activePort = null;
    if (port?.isOpen) await new Promise((resolve) => port.close(() => resolve()));
  };

  const openCandidate = () => {
    if (stopped) return;
    retryTimer = null;
    let receiveBuffer = Buffer.alloc(0);
    let rawByteCount = 0;
    let lastRawReport = 0;
    let parsedReadingSeen = false;

    report({ connected: false, message: `Đang mở ${path} ${baudRate}, 8N${stopBits}` });
    const port = new SerialPort({
      path,
      baudRate,
      dataBits: 8,
      stopBits,
      parity: "none",
      autoOpen: false,
    });
    activePort = port;

    port.on("data", (chunk) => {
      rawByteCount += chunk.length;
      receiveBuffer = Buffer.concat([receiveBuffer, chunk]).subarray(-512);
      let reading = extractReading(receiveBuffer);
      const now = Date.now();
      if (!reading && !parsedReadingSeen && now - lastRawReport >= 1000) {
        lastRawReport = now;
        report({
          connected: false,
          signalDetected: true,
          stopBits,
          rawByteCount,
          rawHex: receiveBuffer.subarray(-64).toString("hex").match(/.{1,2}/g)?.join(" ").toUpperCase() || "",
          message: `${path} có tín hiệu • đang nhận dạng giao thức đầu cân`,
        });
      }
      while (reading) {
        parsedReadingSeen = true;
        receiveBuffer = receiveBuffer.subarray(reading.consumed);
        report({ connected: true, protocol: reading.protocol, stopBits, message: "Đầu cân đã kết nối" });
        onWeight?.(reading.weight, { protocol: reading.protocol, path, baudRate, stopBits });
        reading = extractReading(receiveBuffer);
      }
    });

    port.on("error", (error) => {
      report({ connected: false, message: `Lỗi ${path}: ${error.message}` });
    });

    port.on("close", () => {
      if (activePort === port) activePort = null;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      scheduleNext(3000);
    });

    port.open((error) => {
      if (error) {
        report({ connected: false, message: `Không mở được ${path}: ${error.message}` });
        activePort = null;
        scheduleNext(3000);
        return;
      }

      report({ connected: false, stopBits, message: `${path} đã mở • chờ dữ liệu từ đầu cân` });

      pollTimer = setInterval(() => {
        if (!port.isOpen || stopped) return;
        port.write(MODBUS_READ_GROSS, () => {});
      }, 500);
    });
  };

  openCandidate();

  return async () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    await closePort();
  };
}
