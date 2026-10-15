const http = require('http');
const { spawn } = require('child_process');

async function main() {
  const edgeProc = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--user-data-dir=' + process.env.TEMP + '\\edgetemp_debug',
    '--window-size=390,844',
    'http://localhost:3001/login'
  ]);

  // wait 2 seconds for edge to open
  await new Promise(r => setTimeout(r, 2000));

  // get ws url from http://localhost:9222/json
  http.get('http://127.0.0.1:9222/json', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const list = JSON.parse(data);
        console.log('Pages found:', list.length);
        const page = list[0];
        console.log('Page Title:', page.title, 'URL:', page.url);
        // Connect via simple CDP HTTP command or WebSocket
        // Or send Runtime.evaluate via WebSocket
        const WebSocket = require('ws'); // check if ws exists or use raw
      } catch (e) {
        console.error(e);
      } finally {
        edgeProc.kill();
      }
    });
  }).on('error', (err) => {
    console.error('Edge debug connect failed:', err.message);
    edgeProc.kill();
  });
}

main();
