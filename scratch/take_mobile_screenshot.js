const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

async function captureMobile() {
  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=9222',
    '--user-data-dir=' + process.env.TEMP + '\\edge_cdp_mobile',
    'http://localhost:3001/login'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  http.get('http://127.0.0.1:9222/json', (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      const list = JSON.parse(data);
      const target = list[0];
      const wsUrl = target.webSocketDebuggerUrl;
      console.log('Target WS:', wsUrl);

      const net = require('net');
      const u = new URL(wsUrl);
      const client = net.createConnection({ host: u.hostname, port: u.port }, () => {
        const key = Buffer.from('1234567890123456').toString('base64');
        client.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });

      let step = 0;
      let rawBuf = Buffer.alloc(0);

      function sendWS(obj) {
        const payload = Buffer.from(JSON.stringify(obj));
        let header;
        if (payload.length < 126) {
          header = Buffer.alloc(6);
          header[0] = 0x81;
          header[1] = 0x80 | payload.length;
          const mask = Buffer.from([1, 2, 3, 4]);
          mask.copy(header, 2);
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
          client.write(Buffer.concat([header, payload]));
        } else if (payload.length < 65536) {
          header = Buffer.alloc(8);
          header[0] = 0x81;
          header[1] = 0x80 | 126;
          header.writeUInt16BE(payload.length, 2);
          const mask = Buffer.from([1, 2, 3, 4]);
          mask.copy(header, 4);
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
          client.write(Buffer.concat([header, payload]));
        }
      }

      client.on('data', (chunk) => {
        rawBuf = Buffer.concat([rawBuf, chunk]);
        const s = rawBuf.toString();
        if (step === 0 && s.includes('HTTP/1.1 101')) {
          step = 1;
          rawBuf = Buffer.alloc(0);
          // Set mobile device metrics
          sendWS({
            id: 1,
            method: 'Emulation.setDeviceMetricsOverride',
            params: {
              width: 390,
              height: 844,
              deviceScaleFactor: 2,
              mobile: true,
              screenOrientation: { angle: 0, type: 'portraitPrimary' }
            }
          });
        } else if (step === 1 && s.includes('"id":1')) {
          step = 2;
          rawBuf = Buffer.alloc(0);
          // Capture screenshot after full render
          setTimeout(() => {
            sendWS({
              id: 2,
              method: 'Page.captureScreenshot',
              params: { format: 'png' }
            });
          }, 2500);
        } else if (step === 2 && s.includes('"id":2')) {
          // Parse response
          try {
            // Find JSON start
            const idx = s.indexOf('{"id":2');
            const endIdx = s.lastIndexOf('}');
            if (idx !== -1 && endIdx > idx) {
              const jsonStr = s.substring(idx, endIdx + 1);
              const res = JSON.parse(jsonStr);
              if (res.result && res.result.data) {
                const imgBuf = Buffer.from(res.result.data, 'base64');
                fs.writeFileSync('scratch/login_mobile_true_cdp.png', imgBuf);
                console.log('Mobile screenshot saved to scratch/login_mobile_true_cdp.png (bytes:', imgBuf.length, ')');
                client.destroy();
                edge.kill();
              }
            }
          } catch (e) {
            // keep accumulating buffer if JSON not complete
          }
        }
      });
    });
  });
}

captureMobile();
