let emojiList: Emoji[] = [];
async function loadEmojiList() {
  try {
    const res = await fetch(config.emojilistUrl);
    emojiList = await res.json() as Emoji[];
    console.log(`Loaded ${emojiList.length} emojis.`);
  } catch (e) {
    console.error('Failed to load emoji list:', e);
    emojiList = [];
  }
}

// CollabVM protocol stuff
function encodeGuacArray(arr: string[]): string {
  return arr.map(s => `${Buffer.byteLength(s, 'utf8')}.${s}`).join(',') + ';';
}
function parseGuacArray(msg: string): string[] {
  const arr: string[] = [];
  let i = 0;
  while (i < msg.length) {
    const dot = msg.indexOf('.', i);
    if (dot === -1) break;
    const len = parseInt(msg.substring(i, dot), 10);
    const str = msg.substr(dot + 1, len);
    arr.push(str);
    i = dot + 1 + len;
    if (msg[i] === ',') i++;
    else if (msg[i] === ';') break;
  }
  return arr;
}
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import WebSocket from 'ws';
// If you see errors about Node.js types, run: yarn add -D @types/node

interface VMConfig {
  url: string;
  nodeId: string;
  origin?: string;
}
interface Config {
  prefix: string;
  vms: VMConfig[];
  authType: 'password' | 'token';
  adminPassword: string;
  botToken: string;
  loginAs: 'admin' | 'mod';
  username: string;
  emojilistUrl: string;
  colonEmoji?: boolean;
}
interface Emoji {
  name: string;
  file: string;
  description: string;
}


const configPath = path.resolve(__dirname, '../config.json');
if (!fs.existsSync(configPath)) {
  console.error('config.json not found. Please copy config.example.json to config.json and fill it in.');
  process.exit(1);
}
const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));


function startBot() {
  loadEmojiList().then(() => {
    for (const vm of config.vms) {
      connectToVM(vm);
    }
  });
}

function connectToVM(vm: VMConfig) {
  const ws = new WebSocket(vm.url, 'guacamole', {
    headers: {
      Origin: vm.origin || 'https://computernewb.com',
    },
  });
  let connected = false;
  let username = config.username;
  let nodeId = vm.nodeId;
  let isAdmin = false;
  let myUser: string = config.username;

  ws.on('open', () => {
    console.log(`[${nodeId}] Connecting to VM, requesting username: ${config.username}`);
    ws.send(encodeGuacArray(['rename', config.username]));
  });

  let awaitingAuth = false;
  let awaitingConnect = false;
  ws.on('message', async (data: WebSocket.RawData) => {
    const msg = data.toString();
    const arr = parseGuacArray(msg);
    if (!arr.length) return;
    const opcode = arr[0];
    if (opcode === 'nop') {
      ws.send(encodeGuacArray(['nop']));
    } else if (opcode === 'auth') {
      // Server requires account authentication
      awaitingAuth = true;
      if (config.authType === 'token') {
        // Send login with bot token
        ws.send(encodeGuacArray(['login', config.botToken]));
      } else {
        // Password authentication not supported on this server
        console.error(`[${nodeId}] Server requires account authentication (bot token). Set authType to "token" and provide a valid botToken in config.`);
        ws.close();
      }
    } else if (opcode === 'list') {
      // Not used
    } else if (opcode === 'rename' && arr[1] === '0') {
      username = arr[3];
      myUser = arr[3];
      if (!awaitingAuth) {
        ws.send(encodeGuacArray(['connect', nodeId]));
      } else {
        awaitingConnect = true;
      }
    } else if (opcode === 'connect' && arr[1] === '1') {
      // Only login as admin if not using account authentication
      if (!awaitingAuth && (config.loginAs === 'admin' || config.loginAs === 'mod') && config.authType === 'password') {
        console.log(`[${nodeId}] Logging in as ${config.loginAs}...`);
        ws.send(encodeGuacArray(['admin', '2', config.adminPassword]));
        isAdmin = true;
      } else if (awaitingAuth) {
        // After account login, we are registered, not admin
        isAdmin = true; // Registered users can use bot features
      }
    } else if (opcode === 'login') {
      // Login response for account authentication
      if (arr[1] === '1') {
        // Success
        if (awaitingConnect) {
          ws.send(encodeGuacArray(['connect', nodeId]));
          awaitingConnect = false;
        }
        isAdmin = true;
        console.log(`[${nodeId}] Logged in with bot token.`);
      } else {
        // Error
        const errMsg = arr[2] || 'Unknown error';
        console.error(`[${nodeId}] Bot token login failed: ${errMsg}`);
        ws.close();
      }
    } else if (opcode === 'adduser') {
      // Not used
    } else if (opcode === 'rename' && arr[1] === '1') {
      // User renamed, arr[2]=old, arr[3]=new
      // ...existing code...
    } else if (opcode === 'admin') {
      // No-op: always assume admin after login command
    } else if (opcode === 'chat') {
      // arr[1] = username, arr[2] = message
      const sender = arr[1];
      const message = arr[2];
      let isCommand = false;
      if (sender && message) {
        if (message.startsWith(config.prefix)) {
          isCommand = true;
        } else if (config.colonEmoji && /^:([a-zA-Z0-9_]+):/.test(message)) {
          isCommand = true;
        }
        if (isCommand) {
          handleCommand(ws, sender, message, isAdmin, nodeId);
        }
      }
    }
  });

  ws.on('close', () => {
    console.log(`[${nodeId}] Disconnected.`);
  });

  ws.on('error', (err: Error) => {
    console.error(`[${nodeId}] WebSocket error:`, err);
  });
}

function handleCommand(ws: WebSocket, sender: string, message: string, isAdmin: boolean, nodeId: string) {
  let args: string[];
  let cmd: string;
  let colonMatch: RegExpMatchArray | null = null;
  if (config.colonEmoji && (colonMatch = message.match(/^:([a-zA-Z0-9_]+):/))) {
    // :emoji: syntax
    cmd = 'emoji';
    args = ['emoji', colonMatch[1]];
  } else {
    args = message.slice(config.prefix.length).trim().split(/\s+/);
    cmd = args[0].toLowerCase();
  }
  if (cmd === 'help') {
    const html = `<div style='background:#222;color:#fff;padding:8px 12px;border-radius:8px;font-family:sans-serif;'>
      <b>EmojiBot Commands:</b><ul style='margin:4px 0 0 16px;padding:0;'>
        <li><b>${config.prefix}help</b> - Show this help</li>
        <li><b>${config.prefix}emojilist</b> - List available emojis</li>
        <li><b>${config.prefix}emoji &lt;name&gt;</b> - Send an emoji</li>
      </ul>
    </div>`;
    ws.send(encodeGuacArray(['admin', '21', html]));
  } else if (cmd === 'emojilist') {
    if (!emojiList.length) {
      sendChat(ws, 'No emojis loaded.');
      return;
    }
    const html = `<div style='background:#222;color:#fff;padding:8px 12px;border-radius:8px;font-family:sans-serif;'>
      <b>Available Emojis:</b>
      <ul style='margin:4px 0 0 16px;padding:0;'>
        ${emojiList.map(e => `<li><b>${e.name}</b>: ${e.description} <img src='${e.file}' alt='${e.name}' style='height:20px;vertical-align:middle;'></li>`).join('')}
      </ul>
    </div>`;
    ws.send(encodeGuacArray(['admin', '21', html]));
  } else if (cmd === 'emoji') {
    if (!isAdmin) {
      sendChat(ws, 'Emoji command requires admin/mod.');
      return;
    }
    const name = args[1];
    if (!name) {
      sendChat(ws, `Usage: ${config.prefix}emoji <name>`);
      return;
    }
    const emoji = emojiList.find(e => e.name === name);
    if (!emoji) {
      sendChat(ws, `Emoji not found. Use ${config.prefix}emojilist to see available emojis.`);
      return;
    }
    // Send XSS image as raw chat (opcode admin, param 1 = 21)
    const imgUrl = emoji.file; // Now a full URL
    const html = `<img src='${imgUrl}' alt='${emoji.name}' style='height:32px;'>`;
    ws.send(encodeGuacArray(['admin', '21', html]));
    console.log(`[${nodeId}] Sent emoji '${name}' for ${sender}`);
  }
}

function sendChat(ws: WebSocket, msg: string) {
  ws.send(encodeGuacArray(['chat', msg]));
}

startBot();
