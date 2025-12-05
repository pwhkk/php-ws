const fs = require('fs');
const http = require('http');
const net = require('net');
const { Buffer } = require('buffer');
const { exec } = require('child_process');
const { WebSocket, createWebSocketStream } = require('ws');

// 读取配置文件（只用其他参数，不保存端口）
let config = {};
try {
  const raw = fs.readFileSync('config.json', 'utf-8');
  config = JSON.parse(raw);
} catch (err) {
  console.error("读取配置文件失败，使用默认值:", err.message);
}

// 使用配置里的变量
const UUID = config.UUID || '55e8ca56-8a0a-4486-b3f9-b9b0d46638a9';
const DOMAIN = config.DOMAIN || 'pp.pwhh.dpdns.org';
const AUTO_ACCESS = config.AUTO_ACCESS || false;
const SUB_PATH = config.SUB_PATH || 'ccc';
const NAME = config.NAME || 'Vls';
const WEB_PATH = config.WEB_PATH || 'web';

// HTTP 服务
const httpServer = http.createServer((req, res) => {
  if (req.url === '/web') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello, World\n');
  } else if (req.url === `/${SUB_PATH}`) {
    const vlessURL = `vless://${UUID}@www.visa.com.tw:443?encryption=none&security=tls&sni=${DOMAIN}&type=ws&host=${DOMAIN}&path=%2F#${NAME}`;
    const base64Content = Buffer.from(vlessURL).toString('base64');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(base64Content + '\n');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  }
});

// WebSocket 服务
const wss = new WebSocket.Server({ server: httpServer });
const uuid = UUID.replace(/-/g, "");
wss.on('connection', ws => {
  ws.once('message', msg => {
    const [VERSION] = msg;
    const id = msg.slice(1, 17);
    if (!id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16))) return;
    let i = msg.slice(17, 18).readUInt8() + 19;
    const port = msg.slice(i, i += 2).readUInt16BE(0);
    const ATYP = msg.slice(i, i += 1).readUInt8();
    const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') :
      (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) :
      (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : ''));
    ws.send(new Uint8Array([VERSION, 0]));
    const duplex = createWebSocketStream(ws);
    net.connect({ host, port }, function() {
      this.write(msg.slice(i));
      duplex.on('error', () => {}).pipe(this).on('error', () => {}).pipe(duplex);
    }).on('error', () => {});
  }).on('error', () => {});
});

// 自动选择端口（50000–65000，不写回配置）
function findAvailablePort(start, end, callback) {
  let port = start;
  function tryPort() {
    const tester = net.createServer()
      .once('error', () => {
        port++;
        if (port > end) callback(new Error('No available ports'));
        else tryPort();
      })
      .once('listening', () => {
        tester.close(() => callback(null, port));
      })
      .listen(port);
  }
  tryPort();
}

findAvailablePort(50000, 65000, (err, port) => {
  if (err) {
    console.error(err.message);
    process.exit(1);
  } else {
    httpServer.listen(port, () => {
      console.log(`🚀 Server is running on port ${port}`);

      // 打印订阅地址（带上实际端口）
      const vlessURL = `vless://${UUID}@${DOMAIN}:${port}?encryption=none&security=none&type=ws&host=${DOMAIN}&path=%2F#${NAME}`;
      const base64Content = Buffer.from(vlessURL).toString('base64');
      console.log("📌 Subscription URL (raw):", vlessURL);
      console.log("📌 Subscription (base64):", base64Content);

      // 自动访问保活
      if (AUTO_ACCESS && DOMAIN) {
        const autoAccessWeb = () => {
          exec(
            `curl -s "https://${DOMAIN}/${WEB_PATH}" > /dev/null`,
            { shell: '/bin/bash' },
            (error) => {
              if (error) console.error('Auto access failed:', error.message);
            }
          );
        };
        setInterval(autoAccessWeb, 20000);
      }
    });
  }
});
