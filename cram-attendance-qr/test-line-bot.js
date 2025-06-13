// test-line-bot.js - 本地測試 LINE Bot
require('dotenv').config(); // 讀取 .env 檔案

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const port = 3001; // 使用不同的 port 避免衝突

// Middleware
app.use(express.json());

// LINE Bot 設定
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_REPLY_API = 'https://api.line.me/v2/bot/message/reply';

console.log('LINE Bot 設定：');
console.log('- Channel Secret:', LINE_CHANNEL_SECRET ? '已設定' : '❌ 未設定');
console.log('- Access Token:', LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '❌ 未設定');

// ===== LINE Webhook 驗證 =====
function validateLineSignature(body, signature) {
  if (!LINE_CHANNEL_SECRET || !signature) {
    console.log('缺少 secret 或 signature');
    return false;
  }
  
  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(JSON.stringify(body))
    .digest('base64');
  
  const isValid = hash === signature;
  console.log('簽名驗證:', isValid ? '✅ 成功' : '❌ 失敗');
  return isValid;
}

// ===== LINE 回覆訊息 =====
async function replyMessage(replyToken, messages) {
  try {
    console.log('準備回覆訊息...');
    const response = await axios.post(LINE_REPLY_API, {
      replyToken,
      messages
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
    console.log('✅ 訊息回覆成功');
    return response.data;
  } catch (error) {
    console.error('❌ 回覆訊息失敗:');
    console.error('- 狀態碼:', error.response?.status);
    console.error('- 錯誤訊息:', error.response?.data || error.message);
  }
}

// ===== LINE Webhook 處理 =====
app.post('/webhook', async (req, res) => {
  console.log('\n=== 收到 Webhook 請求 ===');
  console.log('Headers:', req.headers);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  // 驗證簽名
  const signature = req.headers['x-line-signature'];
  if (!validateLineSignature(req.body, signature)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const events = req.body.events || [];
  console.log(`收到 ${events.length} 個事件`);
  
  for (const event of events) {
    console.log('\n處理事件:', event.type);
    
    // 處理加好友事件
    if (event.type === 'follow') {
      const userId = event.source.userId;
      const replyToken = event.replyToken;
      
      console.log('👤 新用戶加入:', userId);
      
      await replyMessage(replyToken, [
        {
          type: 'text',
          text: `歡迎加入育名補習班點名通知系統！\n\n您的 LINE User ID 是：\n${userId}\n\n請將此 ID 提供給補習班老師，以便設定簽到通知。`
        },
        {
          type: 'text',
          text: '請將上面的 ID 提供給補習班老師進行設定。\n\n設定完成後，當您的孩子簽到時，您將會在此收到通知。'
        }
      ]);
    }
    
    // 處理文字訊息 - 不回應任何訊息
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const text = event.message.text.trim();
      
      console.log(`💬 收到訊息: "${text}" from ${userId}`);
      console.log('（不回應一般訊息，User ID 已在加好友時提供）');
      
      // 不做任何回應
    }
  }
  
  res.json({ success: true });
});

// ===== 健康檢查 =====
app.get('/', (req, res) => {
  res.send(`
    <h1>LINE Bot 本地測試伺服器</h1>
    <p>狀態：運行中</p>
    <p>Webhook URL: POST /webhook</p>
    <p>Port: ${port}</p>
    <hr>
    <p>請使用 ngrok 暴露此 port 來測試</p>
  `);
});

// 啟動伺服器
app.listen(port, () => {
  console.log(`\n🚀 LINE Bot 測試伺服器啟動`);
  console.log(`📍 http://localhost:${port}`);
  console.log(`\n下一步：使用 ngrok 暴露此 port`);
  console.log(`指令：ngrok http ${port}`);
});