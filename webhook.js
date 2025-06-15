// api/webhook.js
const crypto = require('crypto');
const axios = require('axios');

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_REPLY_API = 'https://api.line.me/v2/bot/message/reply';

// LINE Webhook 驗證
function validateLineSignature(body, signature) {
  if (!LINE_CHANNEL_SECRET || !signature) return false;
  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(JSON.stringify(body))
    .digest('base64');
  return hash === signature;
}

// LINE 回覆訊息
async function replyMessage(replyToken, messages) {
  try {
    await axios.post(LINE_REPLY_API, {
      replyToken,
      messages
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
    console.log('訊息回覆成功');
  } catch (error) {
    console.error('回覆訊息失敗:', error.response?.data || error.message);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('收到 LINE Webhook');
  const signature = req.headers['x-line-signature'];
  if (!validateLineSignature(req.body, signature)) {
    console.log('簽名驗證失敗');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === 'follow') {
      const userId = event.source.userId;
      const replyToken = event.replyToken;
      console.log('新用戶加入:', userId);
      await replyMessage(replyToken, [
        {
          type: 'text',
          text: `歡迎加入育名補習班點名通知系統！\n\n您的 LINE User ID 是：\n${userId}\n\n請將此 ID 提供給補習班老師，以便設定簽到通知。`
        },
        {
          type: 'text',
          text: '設定完成後，當您的孩子簽到時，您將會收到即時通知。\n\n如需再次查詢您的 User ID，請輸入「我的ID」。'
        }
      ]);
    }
    
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const text = event.message.text.trim();
      const replyToken = event.replyToken;
      console.log('收到訊息:', text, 'from', userId);
      
      if (['我的ID', 'ID', 'id', '我的id'].includes(text)) {
        await replyMessage(replyToken, [{
          type: 'text',
          text: `您的 LINE User ID 是：\n${userId}\n\n請將此 ID 提供給補習班老師。`
        }]);
      } else if (['說明', '功能', 'help'].includes(text)) {
        await replyMessage(replyToken, [{
          type: 'text',
          text: '育名補習班點名通知系統\n\n功能說明：\n1. 輸入「我的ID」查詢您的 User ID\n2. 將 User ID 提供給老師\n3. 設定完成後會收到孩子的簽到通知\n\n如有問題請聯絡補習班。'
        }]);
      }
    }
  }
  
  res.json({ success: true });
};
