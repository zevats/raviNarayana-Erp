const http = require('http');
const { spawn } = require('child_process');

async function run() {
  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--user-data-dir=' + process.env.TEMP + '\\edge_inspect',
    '--window-size=390,844',
    'http://localhost:3001/login'
  ]);

  await new Promise(r => setTimeout(r, 2500));

  http.get('http://127.0.0.1:9222/json', (res) => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end', async () => {
      try {
        const pages = JSON.parse(raw);
        const wsUrl = pages[0]?.webSocketDebuggerUrl;
        console.log('WS URL:', wsUrl);
        if (!wsUrl) return;

        // Simple raw WebSocket client in Node without npm packages
        const net = require('net');
        const url = new URL(wsUrl);
        const client = net.createConnection({ host: url.hostname, port: url.port }, () => {
          const key = Buffer.from('1234567890123456').toString('base64');
          client.write(`GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
        });

        client.on('data', (buf) => {
          const str = buf.toString();
          if (str.includes('HTTP/1.1 101')) {
            // WS connected, send Runtime.evaluate
            const expr = `(function() {
              return JSON.stringify({
                windowWidth: window.innerWidth,
                bodyWidth: document.body.offsetWidth,
                mainWidth: document.querySelector('main')?.offsetWidth,
                cardWidth: document.querySelector('.bg-white')?.offsetWidth,
                wideElements: Array.from(document.querySelectorAll('*')).filter(e => e.offsetWidth > 390).map(e => ({ tag: e.tagName, cls: e.className, w: e.offsetWidth }))
              });
            })()`;
            const msg = JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } });
            const payload = Buffer.from(msg);
            // frame: fin (0x81), masked (0x80 | length)
            const frame = Buffer.alloc(6 + payload.length);
            frame[0] = 0x81;
            frame[1] = 0x80 | payload.length;
            const mask = Buffer.from([1, 2, 3, 4]);
            mask.copy(frame, 2);
            for (let i = 0; i < payload.length; i++) {
              frame[6 + i] = payload[i] ^ mask[i % 4];
            }
            client.write(frame);
          } else {
            // response frame
            // find json in str
            const jsonStart = str.indexOf('{"id":1');
            if (jsonStart !== -1) {
              const resJson = JSON.parse(str.slice(jsonStart));
              console.log('CDP RESULT:', resJson.result?.result?.value);
              client.destroy();
              edge.kill();
            }
          }
        });
      } catch (e) {
        console.error(e);
        edge.kill();
      }
    });
  }).on('error', (e) => {
    console.error(e);
    edge.kill();
  });
}

run();
